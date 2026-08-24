import type { PermissionKey } from './permission-catalog.js';

/**
 * The eight system role templates the specification requires, seeded per organization the first
 * time its roles are read (mirrors `starterChartForTemplate`/`ensureStarterChart`'s lazy-seed
 * pattern for the chart of accounts).
 *
 * Each organization holds its own copy of these rows rather than sharing one global row per key, so
 * a permission change to one organization's "Administrator" role can never affect another's -- the
 * same tenant-isolation shape every other organization-scoped table in this schema already has.
 */
export const SYSTEM_ROLE_KEYS = [
  'OWNER',
  'ADMIN',
  'ACCOUNTANT',
  'SALES',
  'PURCHASES',
  'INVENTORY_MANAGER',
  'PROJECT_MANAGER',
  'VIEWER',
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface SystemRoleTemplate {
  readonly key: SystemRoleKey;
  readonly name: string;
  readonly description: string;
  readonly isOwnerRole: boolean;
  /** Ignored for the owner role, which is always seeded with the full catalog regardless. */
  readonly permissions: readonly PermissionKey[];
}

const READ_ONLY_BASELINE: readonly PermissionKey[] = [
  'organization.view',
  'members.view',
  'roles.view',
  'periods.view',
  'numbering.view',
  'accounts.view',
  'journals.view',
  'tax.codes.view',
  'customers.view',
  'catalog.view',
];

export const SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = Object.freeze([
  {
    key: 'OWNER',
    name: 'Owner',
    description: 'Full control, including organization settings and finalization.',
    isOwnerRole: true,
    // Ignored at seed time: the owner role always receives the complete permission catalog.
    permissions: [],
  },
  {
    key: 'ADMIN',
    name: 'Administrator',
    description: 'Manages the team, settings, and day-to-day accounting operations.',
    isOwnerRole: false,
    permissions: [
      'organization.view',
      'organization.update',
      'members.view',
      'members.invite',
      'members.update',
      'members.remove',
      'invitations.view',
      'invitations.revoke',
      'roles.view',
      'roles.create',
      'roles.update',
      'roles.delete',
      'roles.assign',
      'settings.currency.manage',
      'periods.view',
      'periods.manage',
      'periods.close',
      'periods.unlock',
      'numbering.view',
      'numbering.manage',
      'accounts.view',
      'accounts.create',
      'accounts.update',
      'accounts.deactivate',
      'journals.view',
      'journals.create',
      'journals.post',
      'journals.reverse',
      'reports.view',
      'tax.codes.view',
      'tax.codes.manage',
      'audit.view',
      'audit.export',
      'customers.view',
      'customers.manage',
      'customers.currency_override',
      'catalog.view',
      'catalog.manage',
    ],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Works with journals, periods, taxes, and reporting.',
    isOwnerRole: false,
    permissions: [
      'organization.view',
      'members.view',
      'invitations.view',
      'roles.view',
      'periods.view',
      'periods.close',
      'numbering.view',
      'accounts.view',
      'journals.view',
      'journals.create',
      'journals.post',
      'journals.reverse',
      'reports.view',
      'tax.codes.view',
      'tax.codes.manage',
      'audit.view',
      'audit.export',
      'customers.view',
      'customers.manage',
      'catalog.view',
      'catalog.manage',
    ],
  },
  {
    key: 'SALES',
    name: 'Sales',
    description: 'Manages customers and the sales pipeline.',
    isOwnerRole: false,
    permissions: [
      'organization.view',
      'customers.view',
      'customers.manage',
      'customers.currency_override',
      'catalog.view',
      'catalog.manage',
    ],
  },
  {
    key: 'PURCHASES',
    name: 'Purchases',
    description:
      'Minimal Phase 1 access; organization read only until the Purchases module arrives.',
    isOwnerRole: false,
    permissions: ['organization.view'],
  },
  {
    key: 'INVENTORY_MANAGER',
    name: 'Inventory Manager',
    description: 'Organization read access; inventory rights arrive with the Inventory module.',
    isOwnerRole: false,
    permissions: ['organization.view'],
  },
  {
    key: 'PROJECT_MANAGER',
    name: 'Project Manager',
    description: 'Organization read access; project rights arrive with the Projects module.',
    isOwnerRole: false,
    permissions: ['organization.view'],
  },
  {
    key: 'VIEWER',
    name: 'Viewer/Auditor',
    description: 'Read-only organization access, including allowed audit and report views.',
    isOwnerRole: false,
    permissions: [...READ_ONLY_BASELINE, 'reports.view', 'audit.view'],
  },
]);

export function isSystemRoleKey(value: string): value is SystemRoleKey {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(value);
}
