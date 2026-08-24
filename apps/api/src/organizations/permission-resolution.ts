import { PROTECTED_PERMISSION_KEYS, type PermissionKey } from './permission-catalog.js';

export function hasPermission(
  permissions: ReadonlySet<PermissionKey>,
  key: PermissionKey,
): boolean {
  return permissions.has(key);
}

/**
 * Guards against a protected key ever ending up as a role's granted permission, regardless of
 * where the grant was attempted from. This is the entire privilege-escalation defence: there is no
 * other check standing between a role-permission write and the database.
 */
export function assertNotProtected(permissionKey: PermissionKey): void {
  if (PROTECTED_PERMISSION_KEYS.has(permissionKey)) {
    throw new ProtectedPermissionError(permissionKey);
  }
}

export class ProtectedPermissionError extends Error {
  constructor(readonly permissionKey: PermissionKey) {
    super(`${permissionKey} cannot be granted to any role.`);
  }
}

/** The organization owner can never be the target of a role change, and can never be reassigned. */
export function canChangeMemberRole(
  currentIsOwnerRole: boolean,
  requestedIsOwnerRole: boolean,
): boolean {
  return !currentIsOwnerRole && !requestedIsOwnerRole;
}

/** The organization owner can never be removed. */
export function canRemoveMember(currentIsOwnerRole: boolean): boolean {
  return !currentIsOwnerRole;
}
