import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvitationStatus, OrganizationStatus } from '@prisma/client';

import { AuthMailerService } from '../auth/auth-mailer.service.js';
import { createOpaqueToken, hashToken } from '../auth/auth.crypto.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from './audit-event.js';
import type { OrganizationContext } from './organization-context.js';
import type { InviteMemberDto, UpdateMemberDto } from './organization.dto.js';
import { canChangeMemberRole, canRemoveMember } from './permission-resolution.js';
import { RolesService } from './roles.service.js';

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PENDING_INVITATIONS = 50;

const roleSelect = {
  select: { id: true, key: true, name: true, isOwnerRole: true },
} as const;

@Injectable()
export class OrganizationMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: AuthMailerService,
    private readonly roles: RolesService,
  ) {}

  async listMembers(organizationId: string) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: [{ role: { isOwnerRole: 'desc' } }, { joinedAt: 'asc' }],
      select: {
        id: true,
        status: true,
        joinedAt: true,
        role: roleSelect,
        user: { select: { id: true, displayName: true, email: true, emailVerifiedAt: true } },
      },
    });

    return members.map((member) => ({
      id: member.id,
      roleId: member.role.id,
      roleKey: member.role.key,
      roleName: member.role.name,
      isOwnerRole: member.role.isOwnerRole,
      status: member.status,
      joinedAt: member.joinedAt.toISOString(),
      userId: member.user.id,
      displayName: member.user.displayName,
      email: member.user.email,
      emailVerified: Boolean(member.user.emailVerifiedAt),
    }));
  }

  /**
   * Changes a member's role and/or status. A member whose current role is the owner role can never
   * be the target, and a role change can never grant the owner role -- `RolesService
   * .resolveAssignableRole` rejects it structurally. There is no other path to ownership than
   * creating the organization, which is what guarantees an organization can never lose its owner.
   */
  async updateMember(
    context: OrganizationContext,
    actor: PublicUser,
    memberId: string,
    input: UpdateMemberDto,
    metadata: RequestMetadata,
  ) {
    if (input.roleId === undefined && input.status === undefined) {
      throw new BadRequestException('Provide a role or a status to change.');
    }

    const member = await this.prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId: context.id },
      select: { id: true, status: true, userId: true, role: roleSelect },
    });
    if (!member) throw new NotFoundException('That member could not be found.');

    let nextRole = member.role;
    if (input.roleId !== undefined) {
      nextRole = await this.roles.resolveAssignableRole(context.id, input.roleId);
    }
    if (!canChangeMemberRole(member.role.isOwnerRole, nextRole.isOwnerRole)) {
      throw new BadRequestException('The organization owner cannot be changed here.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organizationMember.update({
        where: { id: memberId },
        data: {
          ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        select: {
          id: true,
          status: true,
          joinedAt: true,
          role: roleSelect,
          user: { select: { id: true, displayName: true, email: true, emailVerifiedAt: true } },
        },
      });

      await tx.securityEvent.create({
        data: {
          userId: actor.id,
          organizationId: context.id,
          eventKey: 'organization.member_updated',
          ipHash: metadata.ipHash,
          metadata: {
            targetUserId: member.userId,
            oldRole: member.role.key,
            newRole: result.role.key,
            oldStatus: member.status,
            newStatus: result.status,
          },
        },
      });

      // Privilege changes get their own before/after record per spec section 12: "Audit actor, old
      // role/permissions and new role/permissions."
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: actor.id,
        eventKey: 'organization.member_updated',
        entityType: 'OrganizationMember',
        entityId: member.id,
        action: 'UPDATE',
        before: { roleKey: member.role.key, status: member.status },
        after: { roleKey: result.role.key, status: result.status },
        metadata: { targetUserId: member.userId },
        ipHash: metadata.ipHash,
      });

      return result;
    });

    return {
      id: updated.id,
      roleId: updated.role.id,
      roleKey: updated.role.key,
      roleName: updated.role.name,
      isOwnerRole: updated.role.isOwnerRole,
      status: updated.status,
      joinedAt: updated.joinedAt.toISOString(),
      userId: updated.user.id,
      displayName: updated.user.displayName,
      email: updated.user.email,
      emailVerified: Boolean(updated.user.emailVerifiedAt),
    };
  }

  async removeMember(
    context: OrganizationContext,
    actor: PublicUser,
    memberId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const member = await this.prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId: context.id },
      select: { id: true, userId: true, role: roleSelect },
    });
    if (!member) throw new NotFoundException('That member could not be found.');
    if (!canRemoveMember(member.role.isOwnerRole)) {
      throw new BadRequestException('The organization owner cannot be removed.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMember.delete({ where: { id: memberId } });
      await tx.securityEvent.create({
        data: {
          userId: actor.id,
          organizationId: context.id,
          eventKey: 'organization.member_removed',
          ipHash: metadata.ipHash,
          metadata: { targetUserId: member.userId, role: member.role.key },
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: actor.id,
        eventKey: 'organization.member_removed',
        entityType: 'OrganizationMember',
        entityId: member.id,
        action: 'DELETE',
        before: { roleKey: member.role.key },
        after: null,
        metadata: { targetUserId: member.userId },
        ipHash: metadata.ipHash,
      });
    });
  }

  async listInvitations(organizationId: string) {
    const invitations = await this.prisma.organizationInvitation.findMany({
      where: { organizationId, status: InvitationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        notifiedAt: true,
        createdAt: true,
        role: roleSelect,
        invitedBy: { select: { displayName: true } },
      },
    });

    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      roleId: invitation.role.id,
      roleKey: invitation.role.key,
      roleName: invitation.role.name,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      delivered: Boolean(invitation.notifiedAt),
      expired: invitation.expiresAt <= new Date(),
      invitedBy: invitation.invitedBy.displayName,
    }));
  }

  async invite(
    context: OrganizationContext,
    user: PublicUser,
    input: InviteMemberDto,
    metadata: RequestMetadata,
  ) {
    const issued = await this.issueInvitation(context, user, input, metadata);
    return issued.invitation;
  }

  /** Internal bootstrap seam: controllers never expose invitation bearer tokens. */
  async issueInvitationForBootstrap(
    context: OrganizationContext,
    user: PublicUser,
    input: InviteMemberDto,
    metadata: RequestMetadata,
  ) {
    return this.issueInvitation(context, user, input, metadata);
  }

  private async issueInvitation(
    context: OrganizationContext,
    user: PublicUser,
    input: InviteMemberDto,
    metadata: RequestMetadata,
  ) {
    this.requireVerifiedEmail(user);

    if (input.email === user.email.toLowerCase()) {
      throw new ConflictException('You are already a member of this organization.');
    }

    const existingMember = await this.prisma.organizationMember.findFirst({
      where: { organizationId: context.id, user: { email: input.email } },
      select: { id: true },
    });
    if (existingMember) {
      throw new ConflictException('That person is already a member of this organization.');
    }

    const role = await this.roles.resolveAssignableRole(context.id, input.roleId);

    const pendingCount = await this.prisma.organizationInvitation.count({
      where: { organizationId: context.id, status: InvitationStatus.PENDING },
    });
    if (pendingCount >= MAX_PENDING_INVITATIONS) {
      throw new ConflictException('This organization has too many pending invitations.');
    }

    const rawToken = createOpaqueToken();
    const deferDelivery = context.status === OrganizationStatus.DRAFT;

    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.organizationInvitation.updateMany({
        where: {
          organizationId: context.id,
          email: input.email,
          status: InvitationStatus.PENDING,
        },
        data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
      });

      const created = await tx.organizationInvitation.create({
        data: {
          organizationId: context.id,
          email: input.email,
          roleId: role.id,
          tokenHash: hashToken(rawToken),
          invitedByUserId: user.id,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          ...(deferDelivery ? {} : { notifiedAt: new Date() }),
        },
        select: {
          id: true,
          email: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          notifiedAt: true,
        },
      });

      await tx.securityEvent.create({
        data: {
          userId: user.id,
          organizationId: context.id,
          eventKey: 'organization.invitation_sent',
          ipHash: metadata.ipHash,
          metadata: {
            invitationId: created.id,
            role: role.key,
            deferred: deferDelivery,
          },
        },
      });

      return created;
    });

    if (!deferDelivery) {
      await this.mailer.sendOrganizationInvitation({
        email: invitation.email,
        organizationName: context.legalName,
        inviterName: user.displayName,
        roleName: role.name,
        token: rawToken,
        expiresAt: invitation.expiresAt,
      });
    }

    return {
      rawToken,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        roleId: role.id,
        roleKey: role.key,
        roleName: role.name,
        status: invitation.status,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
        delivered: Boolean(invitation.notifiedAt),
        expired: false,
        invitedBy: user.displayName,
      },
    };
  }

  async revokeInvitation(
    context: OrganizationContext,
    user: PublicUser,
    invitationId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const revoked = await this.prisma.organizationInvitation.updateMany({
      where: {
        id: invitationId,
        organizationId: context.id,
        status: InvitationStatus.PENDING,
      },
      data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new NotFoundException('That invitation is no longer pending.');

    await this.prisma.securityEvent.create({
      data: {
        userId: user.id,
        organizationId: context.id,
        eventKey: 'organization.invitation_revoked',
        ipHash: metadata.ipHash,
        metadata: { invitationId },
      },
    });
  }

  private requireVerifiedEmail(user: PublicUser): void {
    if (!user.emailVerified) {
      throw new ForbiddenException('Verify your email address before setting up an organization.');
    }
  }
}
