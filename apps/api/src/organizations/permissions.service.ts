import { BadRequestException, Injectable } from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  DEFAULT_ROLE_PERMISSIONS,
  isPermissionKey,
  OVERRIDABLE_ROLES,
  PERMISSION_CATALOG,
  PROTECTED_PERMISSION_KEYS,
  type PermissionKey,
} from './permission-catalog.js';
import { effectivePermissions, type RoleOverrideRow } from './permission-resolution.js';

interface MembershipRoleRef {
  organizationId: string;
  role: OrganizationRole;
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveEffectivePermissions(
    organizationId: string,
    role: OrganizationRole,
  ): Promise<ReadonlySet<PermissionKey>> {
    if (role === OrganizationRole.OWNER) return effectivePermissions(role, []);

    const overrides = await this.prisma.organizationRolePermission.findMany({
      where: { organizationId, role },
      select: { permissionKey: true, granted: true },
    });
    return effectivePermissions(role, overrides);
  }

  /** One query for every organization a user belongs to, used by `GET /organizations`. */
  async resolveEffectivePermissionsBatch(
    memberships: readonly MembershipRoleRef[],
  ): Promise<Map<string, ReadonlySet<PermissionKey>>> {
    const nonOwnerOrgIds = memberships
      .filter((membership) => membership.role !== OrganizationRole.OWNER)
      .map((membership) => membership.organizationId);

    const overrides = nonOwnerOrgIds.length
      ? await this.prisma.organizationRolePermission.findMany({
          where: { organizationId: { in: nonOwnerOrgIds } },
          select: { organizationId: true, role: true, permissionKey: true, granted: true },
        })
      : [];

    const overridesByOrgRole = new Map<string, RoleOverrideRow[]>();
    for (const override of overrides) {
      const key = `${override.organizationId}:${override.role}`;
      const rows = overridesByOrgRole.get(key);
      if (rows) rows.push(override);
      else overridesByOrgRole.set(key, [override]);
    }

    const result = new Map<string, ReadonlySet<PermissionKey>>();
    for (const membership of memberships) {
      const rows = overridesByOrgRole.get(`${membership.organizationId}:${membership.role}`) ?? [];
      result.set(membership.organizationId, effectivePermissions(membership.role, rows));
    }
    return result;
  }

  /** Backs `GET /organizations/:organizationId/roles`. */
  async getRoleMatrix(organizationId: string) {
    const overrides = await this.prisma.organizationRolePermission.findMany({
      where: { organizationId },
      orderBy: [{ role: 'asc' }, { permissionKey: 'asc' }],
      select: {
        role: true,
        permissionKey: true,
        granted: true,
        updatedAt: true,
        updatedBy: { select: { displayName: true } },
      },
    });

    const overridesByRole = new Map<OrganizationRole, RoleOverrideRow[]>();
    for (const override of overrides) {
      const rows = overridesByRole.get(override.role);
      if (rows) rows.push(override);
      else overridesByRole.set(override.role, [override]);
    }

    const roles: OrganizationRole[] = [OrganizationRole.OWNER, ...OVERRIDABLE_ROLES];
    const effective = roles.map((role) => ({
      role,
      overridable: role !== OrganizationRole.OWNER,
      permissions: Array.from(effectivePermissions(role, overridesByRole.get(role) ?? [])),
    }));

    return {
      catalog: PERMISSION_CATALOG,
      defaults: DEFAULT_ROLE_PERMISSIONS,
      overrides: overrides.map((override) => ({
        role: override.role,
        permissionKey: override.permissionKey,
        granted: override.granted,
        updatedAt: override.updatedAt.toISOString(),
        updatedBy: override.updatedBy.displayName,
      })),
      effective,
    };
  }

  /**
   * Applies a batch of permission changes to one role. Rejects OWNER (no editable permission set)
   * and any change targeting a protected key (no grant path exists for `roles.manage` or
   * `organization.finalize` — this is what makes escalation impossible rather than merely checked).
   * A change that matches the default baseline again deletes its override row instead of storing a
   * redundant one, keeping the table sparse.
   */
  async updateRolePermissions(
    organizationId: string,
    roleParam: string,
    changes: readonly { permissionKey: string; granted: boolean }[],
    user: PublicUser,
    metadata: RequestMetadata,
  ) {
    if (!OVERRIDABLE_ROLES.includes(roleParam as OrganizationRole)) {
      throw new BadRequestException('That role cannot be changed.');
    }
    const role = roleParam as OrganizationRole;

    for (const change of changes) {
      if (!isPermissionKey(change.permissionKey)) {
        throw new BadRequestException(`Unknown permission: ${change.permissionKey}`);
      }
      if (PROTECTED_PERMISSION_KEYS.has(change.permissionKey)) {
        throw new BadRequestException(`${change.permissionKey} cannot be changed.`);
      }
    }

    const before = await this.resolveEffectivePermissions(organizationId, role);

    await this.prisma.$transaction(async (tx) => {
      for (const change of changes) {
        const permissionKey = change.permissionKey as PermissionKey;
        const isDefault = DEFAULT_ROLE_PERMISSIONS[role].includes(permissionKey) === change.granted;

        if (isDefault) {
          await tx.organizationRolePermission.deleteMany({
            where: { organizationId, role, permissionKey },
          });
        } else {
          await tx.organizationRolePermission.upsert({
            where: { organizationId_role_permissionKey: { organizationId, role, permissionKey } },
            create: {
              organizationId,
              role,
              permissionKey,
              granted: change.granted,
              updatedByUserId: user.id,
            },
            update: { granted: change.granted, updatedByUserId: user.id },
          });
        }
      }

      await tx.securityEvent.create({
        data: {
          userId: user.id,
          organizationId,
          eventKey: 'organization.role_permissions_updated',
          ipHash: metadata.ipHash,
          metadata: {
            role,
            changes,
            before: Array.from(before),
          },
        },
      });
    });

    return this.getRoleMatrix(organizationId);
  }
}
