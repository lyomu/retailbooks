import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
} from '../src/organizations/permission-catalog';
import {
  canChangeMemberRole,
  canRemoveMember,
  effectivePermissions,
} from '../src/organizations/permission-resolution';

describe('effectivePermissions', () => {
  it('grants OWNER every catalog key regardless of overrides', () => {
    const permissions = effectivePermissions('OWNER', [
      { permissionKey: 'organization.view', granted: false },
      { permissionKey: 'roles.manage', granted: false },
    ]);

    for (const key of PERMISSION_KEYS) {
      expect(permissions.has(key)).toBe(true);
    }
  });

  it('matches the catalog default for ADMIN with no overrides', () => {
    const permissions = effectivePermissions('ADMIN', []);
    expect(Array.from(permissions).sort()).toEqual([...DEFAULT_ROLE_PERMISSIONS.ADMIN].sort());
  });

  it('matches the catalog default for STAFF with no overrides', () => {
    const permissions = effectivePermissions('STAFF', []);
    expect(Array.from(permissions).sort()).toEqual([...DEFAULT_ROLE_PERMISSIONS.STAFF].sort());
  });

  it('grants an extra key via override without disturbing the rest of the default set', () => {
    const permissions = effectivePermissions('STAFF', [
      { permissionKey: 'members.invite', granted: true },
    ]);

    expect(permissions.has('members.invite')).toBe(true);
    for (const key of DEFAULT_ROLE_PERMISSIONS.STAFF) {
      expect(permissions.has(key)).toBe(true);
    }
  });

  it('revokes a default key via override without disturbing the rest of the default set', () => {
    const permissions = effectivePermissions('ADMIN', [
      { permissionKey: 'members.remove', granted: false },
    ]);

    expect(permissions.has('members.remove')).toBe(false);
    for (const key of DEFAULT_ROLE_PERMISSIONS.ADMIN) {
      if (key !== 'members.remove') expect(permissions.has(key)).toBe(true);
    }
  });

  it('ignores an override that targets a protected key', () => {
    const grantAttempt = effectivePermissions('ADMIN', [
      { permissionKey: 'roles.manage', granted: true },
    ]);
    expect(grantAttempt.has('roles.manage')).toBe(false);

    const revokeAttempt = effectivePermissions('OWNER', [
      { permissionKey: 'organization.finalize', granted: false },
    ]);
    expect(revokeAttempt.has('organization.finalize')).toBe(true);
  });

  it('ignores an override naming a key outside the current catalog', () => {
    expect(() =>
      effectivePermissions('STAFF', [{ permissionKey: 'banking.reconcile', granted: true }]),
    ).not.toThrow();

    const permissions = effectivePermissions('STAFF', [
      { permissionKey: 'banking.reconcile', granted: true },
    ]);
    expect(Array.from(permissions).sort()).toEqual([...DEFAULT_ROLE_PERMISSIONS.STAFF].sort());
  });

  it('never lets a non-OWNER default set include a protected key', () => {
    for (const role of ['ADMIN', 'ACCOUNTANT', 'STAFF'] as const) {
      for (const key of DEFAULT_ROLE_PERMISSIONS[role]) {
        const definition = PERMISSION_CATALOG.find((permission) => permission.key === key);
        expect(definition?.protected).toBe(false);
      }
    }
  });
});

describe('canChangeMemberRole', () => {
  it('rejects OWNER as the current role', () => {
    expect(canChangeMemberRole('OWNER', 'ADMIN')).toBe(false);
  });

  it('rejects OWNER as the requested role', () => {
    expect(canChangeMemberRole('ADMIN', 'OWNER')).toBe(false);
  });

  it('allows a change between non-owner roles', () => {
    expect(canChangeMemberRole('ADMIN', 'STAFF')).toBe(true);
  });
});

describe('canRemoveMember', () => {
  it('rejects OWNER', () => {
    expect(canRemoveMember('OWNER')).toBe(false);
  });

  it('allows removing a non-owner member', () => {
    expect(canRemoveMember('STAFF')).toBe(true);
  });
});
