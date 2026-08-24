import { z } from 'zod';

export const serviceStatusSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
});

export const queueStatusSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['up', 'degraded', 'down']),
  depth: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('retailbooks-api'),
  version: z.string(),
  timestamp: z.iso.datetime(),
  dependencies: z.array(serviceStatusSchema).optional(),
  queues: z.array(queueStatusSchema).optional(),
});

export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type QueueStatus = z.infer<typeof queueStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1),
  emailVerified: z.boolean(),
  status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED']),
});

export const authMessageResponseSchema = z.object({
  data: z.object({ message: z.string().min(1) }),
});

export const meResponseSchema = z.object({ data: publicUserSchema });

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  lastSeenAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  current: z.boolean(),
});

export const organizationStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED']);
export const onboardingStepSchema = z.enum([
  'PROFILE',
  'JURISDICTION',
  'ACCOUNTING',
  'TAX',
  'NUMBERING',
  'TEAM',
  'REVIEW',
  'COMPLETE',
]);
export const businessTypeSchema = z.enum([
  'SOLE_PROPRIETOR',
  'PARTNERSHIP',
  'LIMITED_COMPANY',
  'NONPROFIT',
  'COOPERATIVE',
  'OTHER',
]);

export const permissionKeySchema = z.enum([
  'organization.view',
  'organization.update',
  'organization.delete',
  'organization.finalize',
  'organization.transfer_ownership',
  'members.view',
  'members.invite',
  'members.update',
  'members.remove',
  'members.resend_invite',
  'invitations.view',
  'invitations.revoke',
  'roles.view',
  'roles.create',
  'roles.update',
  'roles.delete',
  'roles.assign',
  'roles.manage',
  'settings.localization.manage',
  'settings.currency.manage',
  'settings.tax.manage',
  'settings.fiscal.manage',
  'settings.numbering.manage',
  'settings.accounting.manage',
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
  'accounts.opening_balances.manage',
  'journals.view',
  'journals.create',
  'journals.post',
  'journals.reverse',
  'journals.approve',
  'reports.view',
  'tax.codes.view',
  'tax.codes.manage',
  'audit.view',
  'audit.export',
  'security.view',
  'security.sessions.manage',
  'security.mfa.manage',
]);

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  legalName: z.string().min(1),
  tradingName: z.string().nullable(),
  slug: z.string().min(1),
  status: organizationStatusSchema,
  onboardingStep: onboardingStepSchema,
  countryCode: z.string().length(2),
  baseCurrency: z.string().length(3),
  /** The member's role name, e.g. "Administrator" or a custom role's name -- already display-ready. */
  role: z.string().min(1),
  joinedAt: z.iso.datetime(),
  permissions: z.array(permissionKeySchema),
});

export const taxTreatmentSchema = z.enum(['EXCLUSIVE', 'INCLUSIVE']);

export const organizationPreferencesSchema = z.object({
  accountingBasis: z.enum(['ACCRUAL', 'CASH']),
  chartTemplate: z.string().min(1),
  booksStartDate: z.string().nullable(),
  taxRegistered: z.boolean(),
  taxIdentifier: z.string().nullable(),
  defaultTaxTreatment: taxTreatmentSchema,
  defaultTaxRate: z.number().min(0).max(100),
  journalPrefix: z.string().min(1),
  numberPadding: z.number().int().min(1).max(10),
  nextJournalNumber: z.number().int().min(1),
  numberingReset: z.enum(['NEVER', 'ANNUAL', 'MONTHLY']),
  countryPackCode: z.string().min(1),
  countryPackVersion: z.string().min(1),
});

export const organizationDetailSchema = z.object({
  id: z.uuid(),
  legalName: z.string().min(1),
  tradingName: z.string().nullable(),
  slug: z.string().min(1),
  businessType: businessTypeSchema,
  countryCode: z.string().length(2),
  baseCurrency: z.string().length(3),
  timeZone: z.string().min(1),
  locale: z.string().min(2),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  fiscalYearStartDay: z.number().int().min(1).max(31),
  status: organizationStatusSchema,
  onboardingStep: onboardingStepSchema,
  onboardingCompletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  role: z.string().min(1),
  preferences: organizationPreferencesSchema.nullable(),
});

export const organizationMemberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string().min(1),
  email: z.email(),
  roleId: z.uuid(),
  /** Stable key, e.g. `OWNER`, `ADMIN`, or a custom role's generated key. */
  roleKey: z.string().min(1),
  /** Display-ready name, e.g. "Administrator". */
  roleName: z.string().min(1),
  isOwnerRole: z.boolean(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  emailVerified: z.boolean(),
  joinedAt: z.iso.datetime(),
});

export const organizationInvitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  roleId: z.uuid(),
  roleKey: z.string().min(1),
  roleName: z.string().min(1),
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  delivered: z.boolean(),
  expired: z.boolean(),
  invitedBy: z.string().min(1),
});

export const invitationPreviewSchema = z.object({
  email: z.email(),
  /** Display-ready role name; there is no id to mutate by from an unauthenticated preview. */
  role: z.string().min(1),
  expiresAt: z.iso.datetime(),
  organizationName: z.string().min(1),
  organizationReady: z.boolean(),
  accountExists: z.boolean(),
  accountVerified: z.boolean(),
});

export const organizationListResponseSchema = z.object({
  data: z.object({
    organizations: z.array(organizationSummarySchema),
    activeOrganizationId: z.uuid().nullable(),
  }),
});

export const permissionDefinitionSchema = z.object({
  key: permissionKeySchema,
  label: z.string().min(1),
  description: z.string().min(1),
  group: z.enum([
    'Organization',
    'Members',
    'Invitations',
    'Roles',
    'Settings',
    'Periods',
    'Numbering',
    'Accounts',
    'Journals',
    'Reports',
    'Tax',
    'Audit',
    'Security',
  ]),
  protected: z.boolean(),
});

/**
 * One organization-scoped role. Its `permissions` array is the role's complete, effective
 * permission set -- there is no separate defaults/overrides distinction to reconcile, unlike the
 * sparse-override model this replaced.
 */
export const roleSummarySchema = z.object({
  id: z.uuid(),
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  isOwnerRole: z.boolean(),
  permissions: z.array(permissionKeySchema),
});

export const roleListResponseSchema = z.object({
  data: z.object({
    roles: z.array(roleSummarySchema),
    catalog: z.array(permissionDefinitionSchema),
  }),
});

export const roleResponseSchema = z.object({ data: roleSummarySchema });

export const permissionCatalogResponseSchema = z.object({
  data: z.array(permissionDefinitionSchema),
});

export const fiscalPeriodStatusSchema = z.enum(['OPEN', 'CLOSED', 'LOCKED']);

export const fiscalPeriodSchema = z.object({
  id: z.uuid(),
  fiscalYearId: z.uuid().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  status: fiscalPeriodStatusSchema,
  closedAt: z.iso.datetime().nullable().optional(),
  lockedAt: z.iso.datetime().nullable().optional(),
  reopenedAt: z.iso.datetime().nullable().optional(),
});

export const fiscalYearSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  status: fiscalPeriodStatusSchema,
  periods: z.array(fiscalPeriodSchema),
});

export const fiscalYearsResponseSchema = z.object({
  data: z.array(fiscalYearSchema),
});

export const numberingScopeSchema = z.object({
  key: z.string().min(1),
  token: z.string().nullable(),
});

export const documentNumberSequenceSchema = z.object({
  id: z.uuid(),
  documentType: z.string().min(1),
  scopeKey: z.string().min(1),
  prefix: z.string().min(1),
  numberPadding: z.number().int().min(1),
  numberingReset: z.enum(['NEVER', 'ANNUAL', 'MONTHLY']),
  nextNumber: z.number().int().min(1),
  lastAllocatedNumber: z.number().int().min(1).nullable(),
  lastAllocatedAt: z.iso.datetime().nullable(),
});

export const numberingResponseSchema = z.object({
  data: z.object({
    journal: z.object({
      prefix: z.string().min(1),
      numberPadding: z.number().int().min(1),
      nextJournalNumber: z.number().int().min(1),
      numberingReset: z.enum(['NEVER', 'ANNUAL', 'MONTHLY']),
      currentScope: numberingScopeSchema,
      sequences: z.array(documentNumberSequenceSchema),
    }),
  }),
});

export const ledgerAccountTypeSchema = z.enum([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
  'COST_OF_SALES',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
]);
export const ledgerNormalBalanceSchema = z.enum(['DEBIT', 'CREDIT']);
export const ledgerAccountStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const journalStatusSchema = z.enum(['DRAFT', 'POSTED', 'REVERSED']);

export const ledgerAccountSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  type: ledgerAccountTypeSchema,
  normalBalance: ledgerNormalBalanceSchema,
  status: ledgerAccountStatusSchema,
  description: z.string().nullable(),
  systemSeed: z.boolean(),
  balanceMinor: z.string().regex(/^-?\d+$/),
});

export const journalSummarySchema = z.object({
  id: z.uuid(),
  reference: z.string().nullable(),
  status: journalStatusSchema,
  journalDate: z.iso.date(),
  currency: z.string().length(3),
  exchangeRate: z.string().nullable(),
  description: z.string().min(1),
  debitMinor: z.string().regex(/^\d+$/),
  creditMinor: z.string().regex(/^\d+$/),
  lineCount: z.number().int().nonnegative(),
  postedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const journalLineSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountCode: z.string().min(1),
  accountName: z.string().min(1),
  lineNumber: z.number().int().positive(),
  description: z.string().nullable(),
  debitMinor: z.string().regex(/^\d+$/),
  creditMinor: z.string().regex(/^\d+$/),
  foreignAmountMinor: z.string().regex(/^\d+$/).nullable(),
  exchangeRate: z.string().nullable(),
  taxCodeId: z.uuid().nullable(),
  taxCodeSnapshot: z.string().nullable(),
  taxTreatmentSnapshot: taxTreatmentSchema.nullable(),
  taxRecoverableSnapshot: z.boolean().nullable(),
  taxRatePercentSnapshot: z.string().nullable(),
  taxableAmountMinor: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
  taxAmountMinor: z
    .string()
    .regex(/^-?\d+$/)
    .nullable(),
});

export const journalDetailSchema = journalSummarySchema.extend({
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  createdBy: z.string().min(1),
  postedBy: z.string().nullable(),
  reversalOf: z.object({ id: z.uuid(), reference: z.string().nullable() }).nullable(),
  reversalJournal: z.object({ id: z.uuid(), reference: z.string().nullable() }).nullable(),
  lines: z.array(journalLineSchema),
  totals: z.object({
    debitMinor: z.string().regex(/^\d+$/),
    creditMinor: z.string().regex(/^\d+$/),
    balanced: z.boolean(),
  }),
});

export const trialBalanceResponseSchema = z.object({
  data: z.object({
    asOf: z.iso.date(),
    rows: z.array(
      z.object({
        accountId: z.uuid(),
        accountCode: z.string().min(1),
        accountName: z.string().min(1),
        accountType: ledgerAccountTypeSchema,
        normalBalance: ledgerNormalBalanceSchema,
        debitMinor: z.string().regex(/^\d+$/),
        creditMinor: z.string().regex(/^\d+$/),
      }),
    ),
    totals: z.object({
      debitMinor: z.string().regex(/^\d+$/),
      creditMinor: z.string().regex(/^\d+$/),
      balanced: z.boolean(),
    }),
  }),
});

export const accountLedgerResponseSchema = z.object({
  data: z.object({
    account: ledgerAccountSchema,
    from: z.iso.date().nullable(),
    to: z.iso.date(),
    openingBalanceMinor: z.string().regex(/^-?\d+$/),
    closingBalanceMinor: z.string().regex(/^-?\d+$/),
    rows: z.array(
      z.object({
        id: z.uuid(),
        journalId: z.uuid(),
        reference: z.string().nullable(),
        journalDate: z.iso.date(),
        description: z.string().min(1),
        debitMinor: z.string().regex(/^\d+$/),
        creditMinor: z.string().regex(/^\d+$/),
        balanceMinor: z.string().regex(/^-?\d+$/),
      }),
    ),
  }),
});

export const taxCodeStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);

export const currencyDefinitionSchema = z.object({
  code: z.string().length(3),
  name: z.string().min(1),
  symbol: z.string().min(1),
  minorUnits: z.number().int().min(0).max(6),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

export const organizationCurrencySchema = currencyDefinitionSchema.extend({
  isBase: z.boolean(),
  enabled: z.boolean(),
});

export const exchangeRateSchema = z.object({
  id: z.uuid(),
  baseCurrency: z.string().length(3),
  quoteCurrency: z.string().length(3),
  quoteCurrencyName: z.string().min(1),
  rate: z.string().min(1),
  rateDate: z.iso.date(),
  source: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export const currencySettingsSchema = z.object({
  baseCurrency: z.string().length(3),
  currencies: z.array(organizationCurrencySchema),
  exchangeRates: z.array(exchangeRateSchema),
});

export const taxCodeSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  treatment: taxTreatmentSchema,
  recoverable: z.boolean(),
  status: taxCodeStatusSchema,
  description: z.string().nullable(),
  salesTaxAccountId: z.uuid().nullable(),
  purchaseTaxAccountId: z.uuid().nullable(),
  systemSeed: z.boolean(),
  currentRatePercent: z.string().nullable(),
});

export const taxRateSchema = z.object({
  id: z.uuid(),
  taxCodeId: z.uuid(),
  ratePercent: z.string(),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable(),
});

export const taxCalculationResultSchema = z.object({
  taxCodeId: z.uuid(),
  taxCode: z.string().min(1),
  treatment: taxTreatmentSchema,
  ratePercent: z.string(),
  asOfDate: z.iso.date(),
  taxableAmountMinor: z.string().regex(/^\d+$/),
  taxAmountMinor: z.string().regex(/^\d+$/),
  totalAmountMinor: z.string().regex(/^\d+$/),
});

export const taxCodeListResponseSchema = z.object({ data: z.array(taxCodeSchema) });
export const taxRateListResponseSchema = z.object({ data: z.array(taxRateSchema) });
export const taxCalculationResponseSchema = z.object({ data: taxCalculationResultSchema });

export const securityEventSchema = z.object({
  id: z.uuid(),
  eventKey: z.string().min(1),
  severity: z.string().min(1),
  occurredAt: z.iso.datetime(),
  ipHash: z.string().nullable(),
  actor: z.object({ id: z.uuid(), displayName: z.string().min(1), email: z.email() }).nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const auditLogResponseSchema = z.object({
  data: z.object({
    events: z.array(securityEventSchema),
    nextCursor: z.string().nullable(),
  }),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    fieldErrors: z.array(z.string()).optional(),
  }),
});

export type PublicUser = z.infer<typeof publicUserSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;
export type BusinessType = z.infer<typeof businessTypeSchema>;
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type OrganizationPreferences = z.infer<typeof organizationPreferencesSchema>;
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;
export type OrganizationInvitation = z.infer<typeof organizationInvitationSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export type PermissionKey = z.infer<typeof permissionKeySchema>;
export type PermissionDefinition = z.infer<typeof permissionDefinitionSchema>;
export type RoleSummary = z.infer<typeof roleSummarySchema>;
export type RoleListResponse = z.infer<typeof roleListResponseSchema>;
export type RoleResponse = z.infer<typeof roleResponseSchema>;
export type PermissionCatalogResponse = z.infer<typeof permissionCatalogResponseSchema>;
export type FiscalPeriodStatus = z.infer<typeof fiscalPeriodStatusSchema>;
export type FiscalPeriod = z.infer<typeof fiscalPeriodSchema>;
export type FiscalYear = z.infer<typeof fiscalYearSchema>;
export type NumberingResponse = z.infer<typeof numberingResponseSchema>;
export type LedgerAccountType = z.infer<typeof ledgerAccountTypeSchema>;
export type LedgerNormalBalance = z.infer<typeof ledgerNormalBalanceSchema>;
export type LedgerAccountStatus = z.infer<typeof ledgerAccountStatusSchema>;
export type JournalStatus = z.infer<typeof journalStatusSchema>;
export type LedgerAccount = z.infer<typeof ledgerAccountSchema>;
export type JournalSummary = z.infer<typeof journalSummarySchema>;
export type JournalLine = z.infer<typeof journalLineSchema>;
export type JournalDetail = z.infer<typeof journalDetailSchema>;
export type CurrencyDefinition = z.infer<typeof currencyDefinitionSchema>;
export type OrganizationCurrency = z.infer<typeof organizationCurrencySchema>;
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;
export type CurrencySettings = z.infer<typeof currencySettingsSchema>;
export type TrialBalanceResponse = z.infer<typeof trialBalanceResponseSchema>;
export type AccountLedgerResponse = z.infer<typeof accountLedgerResponseSchema>;
export type TaxTreatment = z.infer<typeof taxTreatmentSchema>;
export type TaxCodeStatus = z.infer<typeof taxCodeStatusSchema>;
export type TaxCode = z.infer<typeof taxCodeSchema>;
export type TaxRate = z.infer<typeof taxRateSchema>;
export type TaxCalculationResult = z.infer<typeof taxCalculationResultSchema>;
export type SecurityEvent = z.infer<typeof securityEventSchema>;
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

/** Shape of `GET /organizations/reference-data`. Values stay configurable per organization. */
export interface OrganizationReferenceData {
  countries: {
    code: string;
    name: string;
    defaultCurrency: string;
    defaultLocale: string;
    defaultTimeZone: string;
    defaultFiscalStartMonth: number;
    defaultFiscalStartDay: number;
    countryPackCode: string;
    countryPackVersion: string;
    suggestedTaxRate: number;
    taxIdentifierLabel: string;
  }[];
  countryPacks: {
    code: string;
    version: string;
    countryCode: string;
    name: string;
    status: 'DEMONSTRATION' | 'GENERIC_FALLBACK';
    defaults: {
      currency: string;
      locale: string;
      timeZone: string;
      fiscalYearStartMonth: number;
      fiscalYearStartDay: number;
      chartTemplate: string;
      journalPrefix: string;
      numberPadding: number;
      numberingReset: 'NEVER' | 'ANNUAL' | 'MONTHLY';
    };
    notes: string[];
  }[];
  currencies: { code: string; name: string; symbol: string; minorUnits: number }[];
  timeZones: string[];
  locales: { code: string; name: string }[];
  chartTemplates: { code: string; name: string; description: string }[];
  businessTypes: { code: BusinessType; name: string }[];
  accountingBases: { code: 'ACCRUAL' | 'CASH'; name: string; description: string }[];
  taxTreatments: { code: 'EXCLUSIVE' | 'INCLUSIVE'; name: string; description: string }[];
  numberingResets: { code: 'NEVER' | 'ANNUAL' | 'MONTHLY'; name: string }[];
}
