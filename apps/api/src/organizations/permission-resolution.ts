import type { OrganizationRole } from '@prisma/client';

import {
  DEFAULT_ROLE_PERMISSIONS,
  isPermissionKey,
  PERMISSION_KEYS,
  PROTECTED_PERMISSION_KEYS,
  type PermissionKey,
} from './permission-catalog.js';

export interface RoleOverrideRow {
  readonly permissionKey: string;
  readonly granted: boolean;
}

/**
 * Effective permission set for one role in one organization.
 *
 * OWNER short-circuits to every catalog key regardless of `overrides` — defence in depth even
 * against a stray override row that somehow targets OWNER. Any other role starts from
 * `DEFAULT_ROLE_PERMISSIONS[role]` and applies each override in order; a row targeting a protected
 * key is ignored (protected keys have no grant path at all, which is the entire escalation-safety
 * mechanism), and a row naming a key outside the current catalog is ignored rather than thrown, so a
 * stale row left behind by a later catalog change never breaks resolution.
 */
export function effectivePermissions(
  role: OrganizationRole,
  overrides: readonly RoleOverrideRow[],
): ReadonlySet<PermissionKey> {
  if (role === 'OWNER') return new Set(PERMISSION_KEYS);

  const permissions = new Set<PermissionKey>(DEFAULT_ROLE_PERMISSIONS[role]);
  for (const override of overrides) {
    if (!isPermissionKey(override.permissionKey)) continue;
    if (PROTECTED_PERMISSION_KEYS.has(override.permissionKey)) continue;
    if (override.granted) permissions.add(override.permissionKey);
    else permissions.delete(override.permissionKey);
  }
  return permissions;
}

export function hasPermission(
  permissions: ReadonlySet<PermissionKey>,
  key: PermissionKey,
): boolean {
  return permissions.has(key);
}

/** OWNER can never be the target of a role change, and a role change can never grant OWNER. */
export function canChangeMemberRole(
  currentRole: OrganizationRole,
  requestedRole: OrganizationRole,
): boolean {
  return currentRole !== 'OWNER' && requestedRole !== 'OWNER';
}

/** OWNER can never be removed. */
export function canRemoveMember(currentRole: OrganizationRole): boolean {
  return currentRole !== 'OWNER';
}
