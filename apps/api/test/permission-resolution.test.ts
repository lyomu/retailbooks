import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  PROTECTED_PERMISSION_KEYS,
} from '../src/organizations/permission-catalog';
import {
  assertNotProtected,
  canChangeMemberRole,
  canRemoveMember,
  ProtectedPermissionError,
} from '../src/organizations/permission-resolution';
import { SYSTEM_ROLE_TEMPLATES } from '../src/organizations/roles-catalog';

describe('SYSTEM_ROLE_TEMPLATES', () => {
  it('defines exactly the eight roles the specification requires', () => {
    expect(SYSTEM_ROLE_TEMPLATES.map((template) => template.key).sort()).toEqual(
      [
        'ACCOUNTANT',
        'ADMIN',
        'INVENTORY_MANAGER',
        'OWNER',
        'PROJECT_MANAGER',
        'PURCHASES',
        'SALES',
        'VIEWER',
      ].sort(),
    );
  });

  it('marks exactly one template as the owner role', () => {
    const owners = SYSTEM_ROLE_TEMPLATES.filter((template) => template.isOwnerRole);
    expect(owners.map((o) => o.key)).toEqual(['OWNER']);
  });

  it('never lets a non-owner template list a protected key', () => {
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      if (template.isOwnerRole) continue;
      for (const key of template.permissions) {
        expect(PROTECTED_PERMISSION_KEYS.has(key)).toBe(false);
      }
    }
  });

  it('lists only permission keys that exist in the current catalog', () => {
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      for (const key of template.permissions) {
        expect((PERMISSION_KEYS as readonly string[]).includes(key)).toBe(true);
      }
    }
  });

  it('keeps each template free of duplicate keys', () => {
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      expect(new Set(template.permissions).size).toBe(template.permissions.length);
    }
  });

  it('gives every non-owner role only organization.view or a documented, broader read set', () => {
    const admin = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'ADMIN');
    const accountant = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'ACCOUNTANT');
    const viewer = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'VIEWER');

    expect(admin?.permissions).toContain('accounts.create');
    expect(admin?.permissions).toContain('accounts.update');
    expect(admin?.permissions).toContain('accounts.deactivate');
    expect(accountant?.permissions).not.toContain('accounts.create');
    expect(accountant?.permissions).toContain('journals.post');
    expect(viewer?.permissions).toContain('audit.view');
    expect(viewer?.permissions).toContain('reports.view');
  });

  it('gives the still-Phase-1-minimal roles only organization.view', () => {
    for (const key of ['INVENTORY_MANAGER', 'PROJECT_MANAGER'] as const) {
      const template = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === key);
      expect(template?.permissions).toEqual(['organization.view']);
    }
  });

  it('gives SALES its real Phase 2 forward-workflow permissions', () => {
    const template = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'SALES');
    expect(template?.permissions).toEqual([
      'organization.view',
      'customers.view',
      'customers.manage',
      'customers.currency_override',
      'catalog.view',
      'catalog.manage',
      'sales.invoices.view',
      'sales.invoices.manage',
      'sales.invoices.issue',
      'sales.payments.view',
      'sales.payments.record',
      'sales.credit_notes.view',
      'sales.credit_notes.manage',
      'sales.credit_notes.issue',
      'sales.quotes.view',
      'sales.quotes.manage',
      'sales.quotes.convert',
      'sales.orders.view',
      'sales.orders.manage',
      'sales.orders.convert',
      'sales.documents.send',
      'sales.recurring_invoices.view',
      'sales.recurring_invoices.manage',
      'sales.statements.view',
    ]);
  });

  it('gives PURCHASES its real Phase 3 forward-workflow permissions', () => {
    const template = SYSTEM_ROLE_TEMPLATES.find((t) => t.key === 'PURCHASES');
    expect(template?.permissions).toEqual([
      'organization.view',
      'vendors.view',
      'vendors.manage',
      'vendors.currency_override',
      'purchases.orders.view',
      'purchases.orders.manage',
      'purchases.orders.issue',
      'purchases.bills.view',
      'purchases.bills.manage',
      'purchases.bills.issue',
      'purchases.expenses.view',
      'purchases.expenses.manage',
      'purchases.expenses.post',
      'purchases.expense_categories.view',
      'purchases.expense_categories.manage',
      'purchases.vendor_credits.view',
      'purchases.vendor_credits.manage',
      'purchases.vendor_credits.issue',
      'purchases.payments_made.view',
      'purchases.payments_made.record',
      'purchases.recurring_bills.view',
      'purchases.recurring_bills.manage',
      'purchases.recurring_expenses.view',
      'purchases.recurring_expenses.manage',
    ]);
    // Same asymmetry as SALES: the money-moving/reversing keys (approve/void/allocate) stay with
    // ADMIN/ACCOUNTANT and never appear on the PURCHASES role.
    expect(template?.permissions.some((key) => key.endsWith('.void'))).toBe(false);
    expect(template?.permissions.some((key) => key.endsWith('.allocate'))).toBe(false);
    expect(template?.permissions.some((key) => key.endsWith('.approve'))).toBe(false);
  });
});

describe('assertNotProtected', () => {
  it('rejects every protected key', () => {
    for (const key of PERMISSION_CATALOG.filter((p) => p.protected).map((p) => p.key)) {
      expect(() => assertNotProtected(key)).toThrow(ProtectedPermissionError);
    }
  });

  it('accepts every unprotected key without throwing', () => {
    for (const key of PERMISSION_CATALOG.filter((p) => !p.protected).map((p) => p.key)) {
      expect(() => assertNotProtected(key)).not.toThrow();
    }
  });
});

describe('canChangeMemberRole', () => {
  it('rejects the owner role as the current role', () => {
    expect(canChangeMemberRole(true, false)).toBe(false);
  });

  it('rejects the owner role as the requested role', () => {
    expect(canChangeMemberRole(false, true)).toBe(false);
  });

  it('allows a change between two non-owner roles', () => {
    expect(canChangeMemberRole(false, false)).toBe(true);
  });
});

describe('canRemoveMember', () => {
  it('rejects the owner role', () => {
    expect(canRemoveMember(true)).toBe(false);
  });

  it('allows removing a non-owner member', () => {
    expect(canRemoveMember(false)).toBe(true);
  });
});
