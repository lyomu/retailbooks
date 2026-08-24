import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { writeAuditEvent } from './audit-event.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  isPermissionKey,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  PROTECTED_PERMISSION_KEYS,
  type PermissionKey,
} from './permission-catalog.js';
import { SYSTEM_ROLE_TEMPLATES, type SystemRoleKey } from './roles-catalog.js';

export interface CreateRoleInput {
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly string[];
}

export interface UpdateRoleInput {
  readonly name?: string;
  readonly description?: string;
  readonly permissions?: readonly string[];
}

const roleWithPermissions = {
  include: { permissions: { select: { permissionKey: true } } },
} satisfies Prisma.RoleDefaultArgs;

type RoleWithPermissions = Prisma.RoleGetPayload<typeof roleWithPermissions>;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seeds the eight system role templates, and their permission rows, for a brand-new organization.
   *
   * Called once, inside the organization-creation transaction, before any membership exists: a
   * membership's `roleId` is a required foreign key, so seeding cannot be deferred to first read the
   * way the starter chart of accounts is.
   */
  async seedSystemRoles(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<
    ReadonlyMap<SystemRoleKey, { id: string; key: string; name: string; isOwnerRole: boolean }>
  > {
    const created = await Promise.all(
      SYSTEM_ROLE_TEMPLATES.map((template) =>
        tx.role.create({
          data: {
            organizationId,
            key: template.key,
            name: template.name,
            description: template.description,
            isSystem: true,
            isOwnerRole: template.isOwnerRole,
            permissions: {
              // The owner role is always seeded with the complete catalog, never the template list --
              // that is what makes its permission set total by construction rather than by convention.
              create: (template.isOwnerRole ? PERMISSION_KEYS : template.permissions).map(
                (key) => ({
                  permissionKey: key,
                }),
              ),
            },
          },
          select: { id: true, key: true, name: true, isOwnerRole: true },
        }),
      ),
    );
    return new Map(created.map((role) => [role.key as SystemRoleKey, role]));
  }

  async listRoles(organizationId: string) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId },
      orderBy: [{ isOwnerRole: 'desc' }, { isSystem: 'desc' }, { name: 'asc' }],
      ...roleWithPermissions,
    });

    return {
      roles: roles.map(toRoleSummary),
      catalog: PERMISSION_CATALOG,
    };
  }

  /** Resolves and validates a role belongs to the organization. Used by member invite/update. */
  async resolveAssignableRole(organizationId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId } });
    if (!role) throw new NotFoundException('That role could not be found.');
    if (role.isOwnerRole) {
      throw new BadRequestException('Ownership cannot be granted through a role assignment.');
    }
    return role;
  }

  async createRole(
    organizationId: string,
    user: PublicUser,
    input: CreateRoleInput,
    metadata: RequestMetadata,
  ) {
    const permissions = this.validatePermissionKeys(input.permissions);
    const key = await this.uniqueRoleKey(organizationId, input.name);

    const created = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          organizationId,
          key,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          isOwnerRole: false,
          permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
        },
        ...roleWithPermissions,
      });

      await writeAuditEvent(tx, {
        organizationId,
        actorUserId: user.id,
        eventKey: 'organization.role_created',
        entityType: 'Role',
        entityId: role.id,
        action: 'CREATE',
        before: null,
        after: { name: role.name, permissions },
        ipHash: metadata.ipHash,
      });

      return role;
    });

    return toRoleSummary(created);
  }

  /**
   * Renames a custom role and/or replaces its permission set. System roles may have their
   * permissions changed but not their name, description, or key -- those are what makes them
   * recognizable across every organization. The owner role accepts neither: its permission set is
   * total and immutable, which is the entire privilege-escalation defence for `roles.manage` and
   * `organization.finalize`.
   */
  async updateRole(
    organizationId: string,
    roleId: string,
    user: PublicUser,
    input: UpdateRoleInput,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId },
      ...roleWithPermissions,
    });
    if (!existing) throw new NotFoundException('That role could not be found.');
    if (existing.isOwnerRole) {
      throw new BadRequestException("The owner role's permissions cannot be changed.");
    }
    if (existing.isSystem && (input.name !== undefined || input.description !== undefined)) {
      throw new BadRequestException('System role names cannot be changed.');
    }

    const nextPermissions =
      input.permissions !== undefined ? this.validatePermissionKeys(input.permissions) : undefined;
    const before = {
      name: existing.name,
      description: existing.description,
      permissions: existing.permissions.map((p) => p.permissionKey).sort(),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(nextPermissions !== undefined
            ? {
                permissions: {
                  deleteMany: {},
                  create: nextPermissions.map((permissionKey) => ({ permissionKey })),
                },
              }
            : {}),
        },
        ...roleWithPermissions,
      });

      const after = {
        name: role.name,
        description: role.description,
        permissions: role.permissions.map((p) => p.permissionKey).sort(),
      };
      if (
        before.name !== after.name ||
        before.description !== after.description ||
        before.permissions.join() !== after.permissions.join()
      ) {
        await writeAuditEvent(tx, {
          organizationId,
          actorUserId: user.id,
          eventKey: 'organization.role_updated',
          entityType: 'Role',
          entityId: role.id,
          action: 'UPDATE',
          before,
          after,
          ipHash: metadata.ipHash,
        });
      }

      return role;
    });

    return toRoleSummary(updated);
  }

  /** Only a custom role with no current member or pending invitation can be deleted. */
  async deleteRole(
    organizationId: string,
    roleId: string,
    user: PublicUser,
    metadata: RequestMetadata,
  ): Promise<void> {
    const existing = await this.prisma.role.findFirst({ where: { id: roleId, organizationId } });
    if (!existing) throw new NotFoundException('That role could not be found.');
    if (existing.isSystem) throw new BadRequestException('System roles cannot be deleted.');

    const [memberCount, invitationCount] = await Promise.all([
      this.prisma.organizationMember.count({ where: { roleId } }),
      this.prisma.organizationInvitation.count({ where: { roleId, status: 'PENDING' } }),
    ]);
    if (memberCount > 0 || invitationCount > 0) {
      throw new ConflictException(
        'Reassign every member and pending invitation off this role before deleting it.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: roleId } });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId: user.id,
        eventKey: 'organization.role_deleted',
        entityType: 'Role',
        entityId: roleId,
        action: 'DELETE',
        before: { name: existing.name },
        after: null,
        ipHash: metadata.ipHash,
      });
    });
  }

  private validatePermissionKeys(input: readonly string[]): PermissionKey[] {
    const seen = new Set<PermissionKey>();
    for (const key of input) {
      if (!isPermissionKey(key)) throw new BadRequestException(`Unknown permission: ${key}`);
      if (PROTECTED_PERMISSION_KEYS.has(key)) {
        throw new BadRequestException(`${key} cannot be granted to any role.`);
      }
      seen.add(key);
    }
    return Array.from(seen);
  }

  private async uniqueRoleKey(organizationId: string, name: string): Promise<string> {
    const base = name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    const stem = base || 'ROLE';

    let candidate = stem;
    for (let suffix = 2; ; suffix += 1) {
      const clash = await this.prisma.role.findUnique({
        where: { organizationId_key: { organizationId, key: candidate } },
        select: { id: true },
      });
      if (!clash) return candidate;
      candidate = `${stem}_${suffix}`.slice(0, 40);
    }
  }
}

function toRoleSummary(role: RoleWithPermissions) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isOwnerRole: role.isOwnerRole,
    permissions: role.permissions.map((p) => p.permissionKey),
  };
}
