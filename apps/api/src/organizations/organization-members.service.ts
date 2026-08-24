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
import type { OrganizationContext } from './organization-context.js';
import type { InviteMemberDto, UpdateMemberDto } from './organization.dto.js';
import { canChangeMemberRole, canRemoveMember } from './permission-resolution.js';

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PENDING_INVITATIONS = 50;

@Injectable()
export class OrganizationMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: AuthMailerService,
  ) {}

  async listMembers(organizationId: string) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      select: {
        id: true,
        role: true,
        status: true,
        joinedAt: true,
        user: { select: { id: true, displayName: true, email: true, emailVerifiedAt: true } },
      },
    });

    return members.map((member) => ({
      id: member.id,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt.toISOString(),
      userId: member.user.id,
      displayName: member.user.displayName,
      email: member.user.email,
      emailVerified: Boolean(member.user.emailVerifiedAt),
    }));
  }

  /**
   * Changes a member's role and/or status. A member whose current role is OWNER can never be the
   * target, and a role change can never grant OWNER — there is no other path to ownership than
   * creating the organization, which is what guarantees an organization can never lose its owner.
   */
  async updateMember(
    context: OrganizationContext,
    actor: PublicUser,
    memberId: string,
    input: UpdateMemberDto,
    metadata: RequestMetadata,
  ) {
    if (input.role === undefined && input.status === undefined) {
      throw new BadRequestException('Provide a role or a status to change.');
    }

    const member = await this.prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId: context.id },
      select: { id: true, role: true, status: true, userId: true },
    });
    if (!member) throw new NotFoundException('That member could not be found.');

    const requestedRole = input.role ?? member.role;
    if (!canChangeMemberRole(member.role, requestedRole)) {
      throw new BadRequestException('The organization owner cannot be changed here.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organizationMember.update({
        where: { id: memberId },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        select: {
          id: true,
          role: true,
          status: true,
          joinedAt: true,
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
            oldRole: member.role,
            newRole: result.role,
            oldStatus: member.status,
            newStatus: result.status,
          },
        },
      });

      return result;
    });

    return {
      id: updated.id,
      role: updated.role,
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
      select: { id: true, role: true, userId: true },
    });
    if (!member) throw new NotFoundException('That member could not be found.');
    if (!canRemoveMember(member.role)) {
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
          metadata: { targetUserId: member.userId, role: member.role },
        },
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
        role: true,
        status: true,
        expiresAt: true,
        notifiedAt: true,
        createdAt: true,
        invitedBy: { select: { displayName: true } },
      },
    });

    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
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
          role: input.role,
          tokenHash: hashToken(rawToken),
          invitedByUserId: user.id,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          ...(deferDelivery ? {} : { notifiedAt: new Date() }),
        },
        select: {
          id: true,
          email: true,
          role: true,
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
            role: created.role,
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
        role: invitation.role,
        token: rawToken,
        expiresAt: invitation.expiresAt,
      });
    }

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      delivered: Boolean(invitation.notifiedAt),
      expired: false,
      invitedBy: user.displayName,
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
