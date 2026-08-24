import type { OrganizationRole } from '@prisma/client';

/**
 * Stable, machine-readable permission keys.
 *
 * Scoped only to endpoints that exist today. A future module (journals, tax, periods, ...) adds its
 * own keys when it ships rather than reserving them in advance.
 */
export const PERMISSION_KEYS = [
  'organization.view',
  'organization.update',
  'organization.finalize',
  'members.view',
  'members.invite',
  'members.update',
  'members.remove',
  'invitations.view',
  'invitations.revoke',
  'roles.view',
  'roles.manage',
  'periods.view',
  'periods.manage',
  'periods.close',
  'periods.unlock',
  'numbering.view',
  'numbering.manage',
  'accounts.view',
  'accounts.manage',
  'journals.view',
  'journals.create',
  'journals.post',
  'journals.reverse',
  'reports.view',
  'tax.codes.view',
  'tax.codes.manage',
  'audit.view',
  'audit.export',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly label: string;
  readonly description: string;
  readonly group:
    | 'Organization'
    | 'Members'
    | 'Invitations'
    | 'Roles'
    | 'Periods'
    | 'Numbering'
    | 'Accounts'
    | 'Journals'
    | 'Reports'
    | 'Tax'
    | 'Audit';
  /** Permanently OWNER-only. No override can grant or revoke a protected key. */
  readonly protected: boolean;
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = Object.freeze([
  {
    key: 'organization.view',
    label: 'View organization profile',
    description: 'See legal, jurisdiction, accounting, tax, and numbering settings.',
    group: 'Organization',
    protected: false,
  },
  {
    key: 'organization.update',
    label: 'Edit organization profile',
    description: "Change the organization's settings.",
    group: 'Organization',
    protected: false,
  },
  {
    key: 'organization.finalize',
    label: 'Finalize onboarding',
    description: 'Activate the organization once setup is complete.',
    group: 'Organization',
    protected: true,
  },
  {
    key: 'members.view',
    label: 'View members',
    description: 'See who belongs to this organization and their role.',
    group: 'Members',
    protected: false,
  },
  {
    key: 'members.invite',
    label: 'Invite members',
    description: 'Send invitations to join this organization.',
    group: 'Members',
    protected: false,
  },
  {
    key: 'members.update',
    label: 'Change member roles',
    description: "Change a member's role, or suspend/reactivate them.",
    group: 'Members',
    protected: false,
  },
  {
    key: 'members.remove',
    label: 'Remove members',
    description: 'Remove a member from this organization.',
    group: 'Members',
    protected: false,
  },
  {
    key: 'invitations.view',
    label: 'View invitations',
    description: 'See pending invitations.',
    group: 'Invitations',
    protected: false,
  },
  {
    key: 'invitations.revoke',
    label: 'Revoke invitations',
    description: 'Withdraw a pending invitation.',
    group: 'Invitations',
    protected: false,
  },
  {
    key: 'roles.view',
    label: 'View roles & permissions',
    description: 'See the permission matrix for this organization.',
    group: 'Roles',
    protected: false,
  },
  {
    key: 'roles.manage',
    label: 'Manage roles & permissions',
    description: 'Change which permissions Administrator, Accountant, and Staff hold.',
    group: 'Roles',
    protected: true,
  },
  {
    key: 'periods.view',
    label: 'View fiscal periods',
    description: 'See fiscal years, periods, and lock status.',
    group: 'Periods',
    protected: false,
  },
  {
    key: 'periods.manage',
    label: 'Create fiscal years',
    description: 'Generate fiscal years and their accounting periods.',
    group: 'Periods',
    protected: false,
  },
  {
    key: 'periods.close',
    label: 'Close and lock periods',
    description: 'Close open periods and lock closed periods against posting.',
    group: 'Periods',
    protected: false,
  },
  {
    key: 'periods.unlock',
    label: 'Unlock and reopen periods',
    description: 'Unlock locked periods and reopen closed periods for correction workflows.',
    group: 'Periods',
    protected: false,
  },
  {
    key: 'numbering.view',
    label: 'View document numbering',
    description: 'See document numbering configuration and current counters.',
    group: 'Numbering',
    protected: false,
  },
  {
    key: 'numbering.manage',
    label: 'Manage document numbering',
    description: 'Change document numbering prefixes, reset cadence, padding, and next numbers.',
    group: 'Numbering',
    protected: false,
  },
  {
    key: 'accounts.view',
    label: 'View chart of accounts',
    description: 'See accounts, account status, and balances.',
    group: 'Accounts',
    protected: false,
  },
  {
    key: 'accounts.manage',
    label: 'Manage chart of accounts',
    description: 'Create, edit, and archive organization accounts.',
    group: 'Accounts',
    protected: false,
  },
  {
    key: 'journals.view',
    label: 'View journals',
    description: 'See draft, posted, and reversed journals.',
    group: 'Journals',
    protected: false,
  },
  {
    key: 'journals.create',
    label: 'Create journal drafts',
    description: 'Create and edit draft journals.',
    group: 'Journals',
    protected: false,
  },
  {
    key: 'journals.post',
    label: 'Post journals',
    description: 'Post balanced journals into open fiscal periods.',
    group: 'Journals',
    protected: false,
  },
  {
    key: 'journals.reverse',
    label: 'Reverse posted journals',
    description: 'Create explicit reversal journals for posted entries.',
    group: 'Journals',
    protected: false,
  },
  {
    key: 'reports.view',
    label: 'View ledger reports',
    description: 'See trial balance and account-ledger inquiries.',
    group: 'Reports',
    protected: false,
  },
  {
    key: 'tax.codes.view',
    label: 'View tax codes',
    description: 'See tax codes, effective-dated rates, and recoverability settings.',
    group: 'Tax',
    protected: false,
  },
  {
    key: 'tax.codes.manage',
    label: 'Manage tax codes',
    description: 'Create, edit, and archive tax codes, and add effective-dated rates.',
    group: 'Tax',
    protected: false,
  },
  {
    key: 'audit.view',
    label: 'View audit log',
    description:
      'See the chronological record of security-relevant actions across this organization.',
    group: 'Audit',
    protected: false,
  },
  {
    key: 'audit.export',
    label: 'Export audit log',
    description: 'Download the audit and security event history as CSV.',
    group: 'Audit',
    protected: false,
  },
]);

export const PROTECTED_PERMISSION_KEYS: ReadonlySet<PermissionKey> = new Set(
  PERMISSION_CATALOG.filter((permission) => permission.protected).map(
    (permission) => permission.key,
  ),
);

/** Roles an organization may adjust. OWNER's permission set is total and immutable. */
export const OVERRIDABLE_ROLES: readonly OrganizationRole[] = ['ADMIN', 'ACCOUNTANT', 'STAFF'];

/** Starting point before any organization-scoped override is applied. */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<OrganizationRole, readonly PermissionKey[]>
> = Object.freeze({
  OWNER: PERMISSION_KEYS,
  ADMIN: [
    'organization.view',
    'organization.update',
    'members.view',
    'members.invite',
    'members.update',
    'members.remove',
    'invitations.view',
    'invitations.revoke',
    'roles.view',
    'periods.view',
    'periods.manage',
    'periods.close',
    'periods.unlock',
    'numbering.view',
    'numbering.manage',
    'accounts.view',
    'accounts.manage',
    'journals.view',
    'journals.create',
    'journals.post',
    'journals.reverse',
    'reports.view',
    'tax.codes.view',
    'tax.codes.manage',
    'audit.view',
    'audit.export',
  ],
  ACCOUNTANT: [
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
  ],
  STAFF: [
    'organization.view',
    'members.view',
    'roles.view',
    'periods.view',
    'numbering.view',
    'accounts.view',
    'journals.view',
    'tax.codes.view',
  ],
});

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}
