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
  'journals.recurring.view',
  'journals.recurring.manage',
  'reports.view',
  'tax.codes.view',
  'tax.codes.manage',
  'audit.view',
  'audit.export',
  'security.view',
  'security.sessions.manage',
  'security.mfa.manage',
  'customers.view',
  'customers.manage',
  'customers.currency_override',
  'catalog.view',
  'catalog.manage',
  'sales.invoices.view',
  'sales.invoices.manage',
  'sales.invoices.issue',
  'sales.invoices.void',
  'sales.invoices.revenue_account_override',
  'sales.payments.view',
  'sales.payments.record',
  'sales.payments.allocate',
  'sales.credit_notes.view',
  'sales.credit_notes.manage',
  'sales.credit_notes.issue',
  'sales.credit_notes.void',
  'sales.credit_notes.allocate',
  'sales.credit_notes.refund',
  'sales.quotes.view',
  'sales.quotes.manage',
  'sales.quotes.approve',
  'sales.quotes.convert',
  'sales.orders.view',
  'sales.orders.manage',
  'sales.orders.approve',
  'sales.orders.convert',
  'sales.documents.send',
  'sales.recurring_invoices.view',
  'sales.recurring_invoices.manage',
  'sales.statements.view',
  'vendors.view',
  'vendors.manage',
  'vendors.currency_override',
  'purchases.orders.view',
  'purchases.orders.manage',
  'purchases.orders.approve',
  'purchases.orders.issue',
  'purchases.bills.view',
  'purchases.bills.manage',
  'purchases.bills.issue',
  'purchases.bills.void',
  'purchases.expenses.view',
  'purchases.expenses.manage',
  'purchases.expenses.approve',
  'purchases.expenses.post',
  'purchases.expenses.void',
  'purchases.expense_categories.view',
  'purchases.expense_categories.manage',
  'purchases.vendor_credits.view',
  'purchases.vendor_credits.manage',
  'purchases.vendor_credits.issue',
  'purchases.vendor_credits.void',
  'purchases.vendor_credits.allocate',
  'purchases.payments_made.view',
  'purchases.payments_made.record',
  'purchases.payments_made.allocate',
  'purchases.recurring_bills.view',
  'purchases.recurring_bills.manage',
  'purchases.recurring_expenses.view',
  'purchases.recurring_expenses.manage',
  'banking.accounts.view',
  'banking.accounts.manage',
  'banking.transactions.view',
  'banking.transactions.manage',
  'banking.rules.view',
  'banking.rules.manage',
  'banking.transfers.view',
  'banking.transfers.manage',
  'banking.reconciliations.view',
  'banking.reconciliations.manage',
  'banking.reconciliations.reopen',
  'inventory.warehouses.view',
  'inventory.warehouses.manage',
  'inventory.movements.view',
  'inventory.adjustments.view',
  'inventory.adjustments.manage',
  'inventory.adjustments.approve',
  'inventory.adjustments.post',
  'inventory.transfers.view',
  'inventory.transfers.manage',
  'inventory.reorder.view',
  'inventory.valuation.view',
  'projects.view',
  'projects.manage',
  'projects.time.view',
  'projects.time.manage',
  'projects.time.approve',
  'projects.expenses.manage',
  'projects.billing.manage',
  'projects.profitability.view',
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
export const inventoryValuationMethodSchema = z.enum(['FIFO', 'WEIGHTED_AVERAGE']);

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
  inventoryValuationMethod: inventoryValuationMethodSchema,
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
    'Sales',
    'Purchases',
    'Banking',
    'Inventory',
    'Projects',
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

// --- Sales: Customers ---

export const contactTypeSchema = z.enum(['CUSTOMER']);
export const contactStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const contactAddressKindSchema = z.enum(['BILLING', 'SHIPPING']);

export const contactAddressSchema = z.object({
  id: z.uuid(),
  kind: contactAddressKindSchema,
  line1: z.string().min(1),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string().length(2),
  isDefault: z.boolean(),
});

export const contactTaxIdSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1),
  value: z.string().min(1),
  countryCode: z.string().length(2).nullable(),
});

export const contactSchema = z.object({
  id: z.uuid(),
  type: contactTypeSchema,
  displayName: z.string().min(1),
  legalName: z.string().nullable(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
  currency: z.string().length(3),
  paymentTermsDays: z.number().int().nullable(),
  receivableAccountId: z.uuid().nullable(),
  status: contactStatusSchema,
  tags: z.array(z.string()),
  addresses: z.array(contactAddressSchema),
  taxIds: z.array(contactTaxIdSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const contactListResponseSchema = z.object({ data: z.array(contactSchema) });
export const contactResponseSchema = z.object({ data: contactSchema });

export const createContactAddressDto = z.object({
  kind: contactAddressKindSchema,
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(32).optional(),
  countryCode: z.string().length(2),
  isDefault: z.boolean().optional(),
});

export const createContactTaxIdDto = z.object({
  label: z.string().min(1).max(24),
  value: z.string().min(1).max(60),
  countryCode: z.string().length(2).optional(),
});

export const createContactDto = z.object({
  displayName: z.string().min(1).max(160),
  legalName: z.string().max(200).optional(),
  email: z.email().optional(),
  phone: z.string().max(40).optional(),
  currency: z.string().length(3).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  receivableAccountId: z.uuid().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  addresses: z.array(createContactAddressDto).max(10).optional(),
  taxIds: z.array(createContactTaxIdDto).max(10).optional(),
});

export const updateContactDto = createContactDto.partial();

// --- Purchases: Vendors ---

export const vendorStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const vendorAddressKindSchema = z.enum(['BILLING', 'SHIPPING']);

export const vendorAddressSchema = z.object({
  id: z.uuid(),
  kind: vendorAddressKindSchema,
  line1: z.string().min(1),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string().length(2),
  isDefault: z.boolean(),
});

export const vendorTaxIdSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1),
  value: z.string().min(1),
  countryCode: z.string().length(2).nullable(),
});

export const vendorSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1),
  legalName: z.string().nullable(),
  email: z.email().nullable(),
  phone: z.string().nullable(),
  currency: z.string().length(3),
  paymentTermsDays: z.number().int().nullable(),
  payableAccountId: z.uuid().nullable(),
  status: vendorStatusSchema,
  tags: z.array(z.string()),
  addresses: z.array(vendorAddressSchema),
  taxIds: z.array(vendorTaxIdSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const vendorListResponseSchema = z.object({ data: z.array(vendorSchema) });
export const vendorResponseSchema = z.object({ data: vendorSchema });

export const vendorDuplicateWarningSchema = z.object({
  code: z.literal('DUPLICATE_VENDOR_WARNING'),
  matches: z.array(
    z.object({
      id: z.uuid(),
      displayName: z.string(),
      matchedOn: z.enum(['displayName', 'taxId']),
    }),
  ),
});

export const createVendorAddressDto = z.object({
  kind: vendorAddressKindSchema,
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(32).optional(),
  countryCode: z.string().length(2),
  isDefault: z.boolean().optional(),
});

export const createVendorTaxIdDto = z.object({
  label: z.string().min(1).max(24),
  value: z.string().min(1).max(60),
  countryCode: z.string().length(2).optional(),
});

export const createVendorDto = z.object({
  displayName: z.string().min(1).max(160),
  legalName: z.string().max(200).optional(),
  email: z.email().optional(),
  phone: z.string().max(40).optional(),
  currency: z.string().length(3).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  payableAccountId: z.uuid().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  addresses: z.array(createVendorAddressDto).max(10).optional(),
  taxIds: z.array(createVendorTaxIdDto).max(10).optional(),
  confirmDuplicate: z.boolean().optional(),
});

export const updateVendorDto = createVendorDto.partial();

// --- Sales: Catalog ---

export const itemTypeSchema = z.enum(['GOODS', 'SERVICE', 'NON_STOCK']);
export const itemStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const unitSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
});

export const categorySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  parentCategoryId: z.uuid().nullable(),
});

export const itemPriceSchema = z.object({
  id: z.uuid(),
  priceListKey: z.string().min(1),
  currency: z.string().length(3),
  unitPriceMinor: z.string().regex(/^\d+$/),
});

export const itemSchema = z.object({
  id: z.uuid(),
  sku: z.string().nullable(),
  name: z.string().min(1),
  itemType: itemTypeSchema,
  categoryId: z.uuid().nullable(),
  defaultUnitId: z.uuid().nullable(),
  revenueAccountId: z.uuid().nullable(),
  purchaseAccountId: z.uuid().nullable(),
  defaultTaxCodeId: z.uuid().nullable(),
  defaultPurchaseTaxCodeId: z.uuid().nullable(),
  inventoryTracked: z.boolean(),
  reorderThreshold: z.string().nullable(),
  reorderQuantity: z.string().nullable(),
  preferredVendorId: z.uuid().nullable(),
  freeDescriptionAllowed: z.boolean(),
  status: itemStatusSchema,
  prices: z.array(itemPriceSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const unitListResponseSchema = z.object({ data: z.array(unitSchema) });
export const categoryListResponseSchema = z.object({ data: z.array(categorySchema) });
export const itemListResponseSchema = z.object({ data: z.array(itemSchema) });
export const itemResponseSchema = z.object({ data: itemSchema });

export const createUnitDto = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1).max(80),
});

export const updateUnitDto = createUnitDto.partial();

export const createCategoryDto = z.object({
  name: z.string().min(1).max(120),
  parentCategoryId: z.uuid().optional(),
});

export const updateCategoryDto = createCategoryDto.partial();

export const itemPriceDto = z.object({
  priceListKey: z.string().min(1).max(40).optional(),
  currency: z.string().length(3),
  unitPriceMinor: z.string().regex(/^\d+$/),
});

export const createItemDto = z.object({
  sku: z.string().max(60).optional(),
  name: z.string().min(1).max(160),
  itemType: itemTypeSchema,
  categoryId: z.uuid().optional(),
  defaultUnitId: z.uuid().optional(),
  revenueAccountId: z.uuid().optional(),
  purchaseAccountId: z.uuid().optional(),
  defaultTaxCodeId: z.uuid().optional(),
  defaultPurchaseTaxCodeId: z.uuid().optional(),
  inventoryTracked: z.boolean().optional(),
  reorderThreshold: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  reorderQuantity: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  preferredVendorId: z.uuid().optional(),
  freeDescriptionAllowed: z.boolean().optional(),
  prices: z.array(itemPriceDto).max(10).optional(),
});

export const updateItemDto = createItemDto.partial();

// --- Sales: Invoices ---

export const invoiceStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
]);

export const invoiceLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  taxCodeSnapshot: z.string().nullable(),
  taxTreatmentSnapshot: taxTreatmentSchema.nullable(),
  taxRecoverableSnapshot: z.boolean().nullable(),
  taxRatePercentSnapshot: z.string().nullable(),
  taxableAmountMinor: z.string().nullable(),
  taxAmountMinor: z.string().nullable(),
  revenueAccountId: z.uuid().nullable(),
  warehouseId: z.uuid().nullable(),
  projectTag: z.string().nullable(),
  projectId: z.uuid().nullable(),
});

export const invoiceSchema = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactName: z.string().min(1),
  invoiceNumber: z.string().nullable(),
  status: invoiceStatusSchema,
  issueDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  currency: z.string().length(3),
  exchangeRate: z.string().nullable(),
  subtotalMinor: z.string().regex(/^\d+$/),
  taxTotalMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  paidMinor: z.string().regex(/^\d+$/),
  balanceMinor: z.string().regex(/^\d+$/),
  journalId: z.uuid().nullable(),
  voidedAt: z.iso.datetime().nullable(),
  sentAt: z.iso.datetime().nullable(),
  lines: z.array(invoiceLineSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const invoiceListResponseSchema = z.object({ data: z.array(invoiceSchema) });
export const invoiceResponseSchema = z.object({ data: invoiceSchema });

export const invoiceLineDto = z.object({
  itemId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/).optional(),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  revenueAccountId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  projectTag: z.string().max(80).optional(),
  projectId: z.uuid().optional(),
});

export const createInvoiceDto = z.object({
  contactId: z.uuid(),
  dueDate: z.iso.date().optional(),
  currency: z.string().length(3).optional(),
  lines: z.array(invoiceLineDto).min(1).max(200),
});

export const updateInvoiceDto = createInvoiceDto.partial();

// --- Purchases: Bills ---

export const billStatusSchema = z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID']);

export const billLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  purchaseOrderLineId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  taxCodeSnapshot: z.string().nullable(),
  taxTreatmentSnapshot: taxTreatmentSchema.nullable(),
  taxRecoverableSnapshot: z.boolean().nullable(),
  taxRatePercentSnapshot: z.string().nullable(),
  taxableAmountMinor: z.string().nullable(),
  taxAmountMinor: z.string().nullable(),
  accountId: z.uuid().nullable(),
  warehouseId: z.uuid().nullable(),
  projectTag: z.string().nullable(),
});

export const billSchema = z.object({
  id: z.uuid(),
  vendorId: z.uuid(),
  vendorName: z.string().min(1),
  purchaseOrderId: z.uuid().nullable(),
  billNumber: z.string().nullable(),
  vendorReference: z.string().nullable(),
  status: billStatusSchema,
  issueDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  currency: z.string().length(3),
  exchangeRate: z.string().nullable(),
  subtotalMinor: z.string().regex(/^\d+$/),
  taxTotalMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  paidMinor: z.string().regex(/^\d+$/),
  balanceMinor: z.string().regex(/^\d+$/),
  journalId: z.uuid().nullable(),
  voidedAt: z.iso.datetime().nullable(),
  lines: z.array(billLineSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const billListResponseSchema = z.object({ data: z.array(billSchema) });
export const billResponseSchema = z.object({ data: billSchema });

export const openingBalanceLineSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  debitMinor: z.string().regex(/^\d+$/),
  creditMinor: z.string().regex(/^\d+$/),
  description: z.string().max(240).nullable(),
});

export const openingBalancePartyLineSchema = z.object({
  id: z.uuid(),
  side: z.enum(['RECEIVABLE', 'PAYABLE']),
  contactId: z.uuid().nullable(),
  vendorId: z.uuid().nullable(),
  nameSnapshot: z.string().min(1).max(160),
  amountMinor: z.string().regex(/^\d+$/),
});

export const openingBalanceBatchSchema = z.object({
  id: z.uuid(),
  status: z.enum(['DRAFT', 'VALIDATED', 'FINALIZED', 'VOID']),
  asOfDate: z.iso.date(),
  description: z.string().max(240).nullable(),
  lines: z.array(openingBalanceLineSchema),
  partyLines: z.array(openingBalancePartyLineSchema),
  totals: z.object({
    debitMinor: z.string().regex(/^\d+$/),
    creditMinor: z.string().regex(/^\d+$/),
    receivableTotalMinor: z.string().regex(/^\d+$/),
    payableTotalMinor: z.string().regex(/^\d+$/),
    balanced: z.boolean(),
  }),
  journalId: z.uuid().nullable(),
  validatedAt: z.iso.datetime().nullable(),
  finalizedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const openingBalanceBatchListResponseSchema = z.object({
  data: z.array(
    openingBalanceBatchSchema.omit({ lines: true, partyLines: true, totals: true }).extend({
      lineCount: z.number().int(),
      partyLineCount: z.number().int(),
    }),
  ),
});
export const openingBalanceBatchResponseSchema = z.object({ data: openingBalanceBatchSchema });

export const openingBalanceLineDto = z.object({
  accountId: z.uuid(),
  debitMinor: z.string().regex(/^\d+$/),
  creditMinor: z.string().regex(/^\d+$/),
  description: z.string().max(240).optional(),
});

export const openingBalancePartyLineDto = z
  .object({
    side: z.enum(['RECEIVABLE', 'PAYABLE']),
    contactId: z.uuid().optional(),
    vendorId: z.uuid().optional(),
    amountMinor: z.string().regex(/^\d+$/),
  })
  .refine(
    (line) => (line.side === 'RECEIVABLE' ? Boolean(line.contactId) : Boolean(line.vendorId)),
    { message: 'A RECEIVABLE party line needs a contactId; a PAYABLE one needs a vendorId' },
  );

export const saveOpeningBalanceBatchDto = z.object({
  asOfDate: z.iso.date(),
  description: z.string().max(240).optional(),
  lines: z.array(openingBalanceLineDto).optional(),
  partyLines: z.array(openingBalancePartyLineDto).optional(),
});

export const billLineDto = z.object({
  itemId: z.uuid().optional(),
  purchaseOrderLineId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  projectTag: z.string().max(80).optional(),
});

export const createBillDto = z.object({
  vendorId: z.uuid(),
  purchaseOrderId: z.uuid().optional(),
  vendorReference: z.string().max(64).optional(),
  dueDate: z.iso.date().optional(),
  currency: z.string().length(3).optional(),
  lines: z.array(billLineDto).min(1).max(200),
});

export const updateBillDto = createBillDto.partial();

export const attachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int(),
  createdAt: z.iso.datetime(),
});

export const attachmentListResponseSchema = z.object({
  data: z.array(attachmentSchema.extend({ downloadUrl: z.url() })),
});
export const attachmentResponseSchema = z.object({ data: attachmentSchema });

// --- Purchases: Expense Categories ---

export const expenseCategorySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string().min(1),
  accountId: z.uuid(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const expenseCategoryListResponseSchema = z.object({ data: z.array(expenseCategorySchema) });
export const expenseCategoryResponseSchema = z.object({ data: expenseCategorySchema });

export const createExpenseCategoryDto = z.object({
  name: z.string().min(1).max(120),
  accountId: z.uuid(),
});

export const updateExpenseCategoryDto = z.object({
  name: z.string().min(1).max(120).optional(),
  accountId: z.uuid().optional(),
  active: z.boolean().optional(),
});

// --- Purchases: Expenses ---

export const expenseStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'VOID',
  'CANCELLED',
]);

export const expenseSchema = z.object({
  id: z.uuid(),
  payeeVendorId: z.uuid().nullable(),
  payeeVendorName: z.string().nullable(),
  payeeName: z.string().nullable(),
  expenseNumber: z.string().nullable(),
  status: expenseStatusSchema,
  expenseDate: z.iso.date(),
  paidThroughAccountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
  /** Cost attribution, frozen onto the journal line when the expense posts (decision D1). */
  projectId: z.uuid().nullable(),
  currency: z.string().length(3),
  amountMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  taxCodeSnapshot: z.string().nullable(),
  taxTreatmentSnapshot: taxTreatmentSchema.nullable(),
  taxRecoverableSnapshot: z.boolean().nullable(),
  taxRatePercentSnapshot: z.string().nullable(),
  taxableAmountMinor: z.string().nullable(),
  taxAmountMinor: z.string().nullable(),
  totalMinor: z.string().regex(/^\d+$/),
  journalId: z.uuid().nullable(),
  voidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const expenseListResponseSchema = z.object({ data: z.array(expenseSchema) });
export const expenseResponseSchema = z.object({ data: expenseSchema });

export const createExpenseDto = z.object({
  payeeVendorId: z.uuid().optional(),
  payeeName: z.string().max(160).optional(),
  expenseDate: z.iso.date(),
  paidThroughAccountId: z.uuid(),
  categoryId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  currency: z.string().length(3).optional(),
  amountMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().optional(),
});

export const updateExpenseDto = createExpenseDto.partial();

// --- Sales: Payments Received ---

export const paymentStatusSchema = z.enum(['UNAPPLIED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED']);

export const paymentAllocationSchema = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string().nullable(),
  amountMinor: z.string().regex(/^\d+$/),
  createdAt: z.iso.datetime(),
});

export const paymentReceivedSchema = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactName: z.string().min(1),
  paymentNumber: z.string().nullable(),
  status: paymentStatusSchema,
  receivedDate: z.iso.date(),
  currency: z.string().length(3),
  amountMinor: z.string().regex(/^\d+$/),
  allocatedMinor: z.string().regex(/^\d+$/),
  unappliedMinor: z.string().regex(/^\d+$/),
  depositAccountId: z.uuid().nullable(),
  journalId: z.uuid().nullable(),
  allocations: z.array(paymentAllocationSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const paymentListResponseSchema = z.object({ data: z.array(paymentReceivedSchema) });
export const paymentResponseSchema = z.object({ data: paymentReceivedSchema });

export const openInvoiceForAllocationSchema = z.object({
  id: z.uuid(),
  invoiceNumber: z.string().nullable(),
  issueDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  currency: z.string().length(3),
  totalMinor: z.string().regex(/^\d+$/),
  paidMinor: z.string().regex(/^\d+$/),
  balanceMinor: z.string().regex(/^\d+$/),
});

export const openInvoiceListResponseSchema = z.object({
  data: z.array(openInvoiceForAllocationSchema),
});

export const createPaymentDto = z.object({
  contactId: z.uuid(),
  receivedDate: z.iso.date(),
  currency: z.string().length(3).optional(),
  amountMinor: z.string().regex(/^\d+$/),
});

export const paymentAllocationLineDto = z.object({
  invoiceId: z.uuid(),
  amountMinor: z.string().regex(/^\d+$/),
});

export const allocatePaymentDto = z.object({
  allocations: z.array(paymentAllocationLineDto).min(1).max(200),
});

// --- Purchases: Payments Made ---

export const paymentMadeAllocationSchema = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  billId: z.uuid(),
  billNumber: z.string().nullable(),
  amountMinor: z.string().regex(/^\d+$/),
  createdAt: z.iso.datetime(),
});

export const paymentMadeSchema = z.object({
  id: z.uuid(),
  vendorId: z.uuid(),
  vendorName: z.string().min(1),
  paymentNumber: z.string().nullable(),
  status: paymentStatusSchema,
  paidDate: z.iso.date(),
  currency: z.string().length(3),
  amountMinor: z.string().regex(/^\d+$/),
  allocatedMinor: z.string().regex(/^\d+$/),
  unappliedMinor: z.string().regex(/^\d+$/),
  paidFromAccountId: z.uuid().nullable(),
  journalId: z.uuid().nullable(),
  allocations: z.array(paymentMadeAllocationSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const paymentMadeListResponseSchema = z.object({ data: z.array(paymentMadeSchema) });
export const paymentMadeResponseSchema = z.object({ data: paymentMadeSchema });

export const createPaymentMadeDto = z.object({
  vendorId: z.uuid(),
  paidDate: z.iso.date(),
  currency: z.string().length(3).optional(),
  amountMinor: z.string().regex(/^\d+$/),
});

export const paymentMadeAllocationLineDto = z.object({
  billId: z.uuid(),
  amountMinor: z.string().regex(/^\d+$/),
});

export const allocatePaymentMadeDto = z.object({
  allocations: z.array(paymentMadeAllocationLineDto).min(1).max(200),
});

// --- Sales: Credit Notes ---

export const creditNoteStatusSchema = z.enum(['DRAFT', 'ISSUED', 'APPLIED', 'REFUNDED', 'VOID']);

export const creditNoteLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  taxCodeSnapshot: z.string().nullable(),
  taxTreatmentSnapshot: taxTreatmentSchema.nullable(),
  taxRecoverableSnapshot: z.boolean().nullable(),
  taxRatePercentSnapshot: z.string().nullable(),
  taxableAmountMinor: z.string().nullable(),
  taxAmountMinor: z.string().nullable(),
  revenueAccountId: z.uuid().nullable(),
  projectTag: z.string().nullable(),
});

export const creditNoteAllocationSchema = z.object({
  id: z.uuid(),
  creditNoteId: z.uuid(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string().nullable(),
  amountMinor: z.string().regex(/^\d+$/),
  journalId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const creditNoteRefundSchema = z.object({
  id: z.uuid(),
  creditNoteId: z.uuid(),
  amountMinor: z.string().regex(/^\d+$/),
  journalId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const creditNoteSchema = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactName: z.string().min(1),
  creditNoteNumber: z.string().nullable(),
  status: creditNoteStatusSchema,
  issueDate: z.iso.date().nullable(),
  currency: z.string().length(3),
  subtotalMinor: z.string().regex(/^\d+$/),
  taxTotalMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  appliedMinor: z.string().regex(/^\d+$/),
  refundedMinor: z.string().regex(/^\d+$/),
  remainingMinor: z.string().regex(/^\d+$/),
  journalId: z.uuid().nullable(),
  voidedAt: z.iso.datetime().nullable(),
  sentAt: z.iso.datetime().nullable(),
  lines: z.array(creditNoteLineSchema),
  allocations: z.array(creditNoteAllocationSchema),
  refunds: z.array(creditNoteRefundSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const creditNoteListResponseSchema = z.object({ data: z.array(creditNoteSchema) });
export const creditNoteResponseSchema = z.object({ data: creditNoteSchema });

export const creditNoteLineDto = z.object({
  itemId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/).optional(),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  revenueAccountId: z.uuid().optional(),
  projectTag: z.string().max(80).optional(),
});

export const createCreditNoteDto = z.object({
  contactId: z.uuid(),
  currency: z.string().length(3).optional(),
  lines: z.array(creditNoteLineDto).min(1).max(200),
});

export const updateCreditNoteDto = createCreditNoteDto.partial();

export const creditNoteAllocationLineDto = z.object({
  invoiceId: z.uuid(),
  amountMinor: z.string().regex(/^\d+$/),
});

export const allocateCreditNoteDto = z.object({
  allocations: z.array(creditNoteAllocationLineDto).min(1).max(200),
});

export const refundCreditNoteDto = z.object({
  amountMinor: z.string().regex(/^\d+$/),
});

// --- Purchases: Vendor Credits ---

export const vendorCreditStatusSchema = z.enum(['DRAFT', 'ISSUED', 'APPLIED', 'VOID']);

export const vendorCreditLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  taxCodeSnapshot: z.string().nullable(),
  taxTreatmentSnapshot: taxTreatmentSchema.nullable(),
  taxRecoverableSnapshot: z.boolean().nullable(),
  taxRatePercentSnapshot: z.string().nullable(),
  taxableAmountMinor: z.string().nullable(),
  taxAmountMinor: z.string().nullable(),
  accountId: z.uuid().nullable(),
  projectTag: z.string().nullable(),
});

export const vendorCreditAllocationSchema = z.object({
  id: z.uuid(),
  vendorCreditId: z.uuid(),
  billId: z.uuid(),
  billNumber: z.string().nullable(),
  amountMinor: z.string().regex(/^\d+$/),
  journalId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const vendorCreditSchema = z.object({
  id: z.uuid(),
  vendorId: z.uuid(),
  vendorName: z.string().min(1),
  sourceBillId: z.uuid().nullable(),
  reason: z.string().nullable(),
  vendorCreditNumber: z.string().nullable(),
  status: vendorCreditStatusSchema,
  issueDate: z.iso.date().nullable(),
  currency: z.string().length(3),
  subtotalMinor: z.string().regex(/^\d+$/),
  taxTotalMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  appliedMinor: z.string().regex(/^\d+$/),
  remainingMinor: z.string().regex(/^\d+$/),
  journalId: z.uuid().nullable(),
  voidedAt: z.iso.datetime().nullable(),
  lines: z.array(vendorCreditLineSchema),
  allocations: z.array(vendorCreditAllocationSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const vendorCreditListResponseSchema = z.object({ data: z.array(vendorCreditSchema) });
export const vendorCreditResponseSchema = z.object({ data: vendorCreditSchema });

export const vendorCreditLineDto = z.object({
  itemId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  projectTag: z.string().max(80).optional(),
});

export const createVendorCreditDto = z.object({
  vendorId: z.uuid(),
  sourceBillId: z.uuid().optional(),
  reason: z.string().max(240).optional(),
  currency: z.string().length(3).optional(),
  lines: z.array(vendorCreditLineDto).min(1).max(200),
});

export const updateVendorCreditDto = createVendorCreditDto.partial();

export const vendorCreditAllocationLineDto = z.object({
  billId: z.uuid(),
  amountMinor: z.string().regex(/^\d+$/),
});

export const allocateVendorCreditDto = z.object({
  allocations: z.array(vendorCreditAllocationLineDto).min(1).max(200),
});

export const openBillForAllocationSchema = z.object({
  id: z.uuid(),
  billNumber: z.string().nullable(),
  issueDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  currency: z.string().length(3),
  totalMinor: z.string().regex(/^\d+$/),
  paidMinor: z.string().regex(/^\d+$/),
  balanceMinor: z.string().regex(/^\d+$/),
});

export const openBillListResponseSchema = z.object({
  data: z.array(openBillForAllocationSchema),
});

// --- Sales: Customer Statements ---

export const statementTransactionTypeSchema = z.enum([
  'INVOICE_ISSUED',
  'PAYMENT_RECEIVED',
  'PAYMENT_ALLOCATED',
  'CREDIT_NOTE_ISSUED',
  'CREDIT_NOTE_ALLOCATED',
  'CREDIT_NOTE_REFUNDED',
]);

export const statementTransactionSchema = z.object({
  id: z.uuid(),
  type: statementTransactionTypeSchema,
  date: z.iso.date(),
  description: z.string().min(1),
  invoiceId: z.uuid().nullable(),
  invoiceNumber: z.string().nullable(),
  paymentId: z.uuid().nullable(),
  paymentNumber: z.string().nullable(),
  creditNoteId: z.uuid().nullable(),
  creditNoteNumber: z.string().nullable(),
  debitMinor: z.string().regex(/^\d+$/),
  creditMinor: z.string().regex(/^\d+$/),
  balanceMinor: z.string().regex(/^-?\d+$/),
});

export const statementSchema = z.object({
  contact: z.object({
    id: z.uuid(),
    displayName: z.string().min(1),
    currency: z.string().length(3),
  }),
  from: z.iso.date().nullable(),
  to: z.iso.date(),
  summary: z.object({
    openingBalanceMinor: z.string().regex(/^-?\d+$/),
    closingBalanceMinor: z.string().regex(/^-?\d+$/),
    invoicedMinor: z.string().regex(/^\d+$/),
    paymentsAllocatedMinor: z.string().regex(/^\d+$/),
    creditNotesAllocatedMinor: z.string().regex(/^\d+$/),
  }),
  transactions: z.array(statementTransactionSchema),
});

export const statementResponseSchema = z.object({ data: statementSchema });

// --- Sales: Quotes ---

export const quoteStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CONVERTED',
]);

export const quoteLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  warehouseId: z.uuid().nullable(),
});

export const quoteSchema = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactName: z.string().min(1),
  quoteNumber: z.string().nullable(),
  status: quoteStatusSchema,
  issueDate: z.iso.date().nullable(),
  expiryDate: z.iso.date().nullable(),
  currency: z.string().length(3),
  subtotalMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  convertedInvoiceId: z.uuid().nullable(),
  sentAt: z.iso.datetime().nullable(),
  lines: z.array(quoteLineSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const quoteListResponseSchema = z.object({ data: z.array(quoteSchema) });
export const quoteResponseSchema = z.object({ data: quoteSchema });

export const quoteLineDto = z.object({
  itemId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/).optional(),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
});

export const createQuoteDto = z.object({
  contactId: z.uuid(),
  expiryDate: z.iso.date().optional(),
  currency: z.string().length(3).optional(),
  lines: z.array(quoteLineDto).min(1).max(200),
});

export const updateQuoteDto = createQuoteDto.partial();

// --- Sales: Sales Orders ---

export const salesOrderStatusSchema = z.enum([
  'DRAFT',
  'APPROVED',
  'CONFIRMED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CANCELLED',
]);

export const salesOrderLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  warehouseId: z.uuid().nullable(),
});

export const salesOrderSchema = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactName: z.string().min(1),
  orderNumber: z.string().nullable(),
  status: salesOrderStatusSchema,
  issueDate: z.iso.date().nullable(),
  currency: z.string().length(3),
  subtotalMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  convertedInvoiceId: z.uuid().nullable(),
  lines: z.array(salesOrderLineSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const salesOrderListResponseSchema = z.object({ data: z.array(salesOrderSchema) });
export const salesOrderResponseSchema = z.object({ data: salesOrderSchema });

export const salesOrderLineDto = z.object({
  itemId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/).optional(),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
});

export const createSalesOrderDto = z.object({
  contactId: z.uuid(),
  currency: z.string().length(3).optional(),
  lines: z.array(salesOrderLineDto).min(1).max(200),
});

export const updateSalesOrderDto = createSalesOrderDto.partial();

// --- Purchases: Purchase Orders ---

export const purchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'APPROVED',
  'ISSUED',
  'CLOSED',
  'CANCELLED',
]);
export const purchaseOrderReceiptStatusSchema = z.enum([
  'NOT_RECEIVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
]);

export const purchaseOrderLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  warehouseId: z.uuid().nullable(),
});

export const purchaseOrderSchema = z.object({
  id: z.uuid(),
  vendorId: z.uuid(),
  vendorName: z.string().min(1),
  orderNumber: z.string().nullable(),
  status: purchaseOrderStatusSchema,
  receiptStatus: purchaseOrderReceiptStatusSchema,
  issueDate: z.iso.date().nullable(),
  expectedDeliveryDate: z.iso.date().nullable(),
  deliveryNote: z.string().nullable(),
  currency: z.string().length(3),
  subtotalMinor: z.string().regex(/^\d+$/),
  totalMinor: z.string().regex(/^\d+$/),
  billedMinor: z.string().regex(/^\d+$/),
  lines: z.array(purchaseOrderLineSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const purchaseOrderListResponseSchema = z.object({ data: z.array(purchaseOrderSchema) });
export const purchaseOrderResponseSchema = z.object({ data: purchaseOrderSchema });

export const purchaseOrderLineDto = z.object({
  itemId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/).optional(),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
});

export const createPurchaseOrderDto = z.object({
  vendorId: z.uuid(),
  currency: z.string().length(3).optional(),
  expectedDeliveryDate: z.iso.date().optional(),
  deliveryNote: z.string().max(500).optional(),
  lines: z.array(purchaseOrderLineDto).min(1).max(200),
});

export const updatePurchaseOrderDto = createPurchaseOrderDto.partial();

export const recordPurchaseOrderReceiptDto = z.object({
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.uuid(),
        quantity: z.string(),
        warehouseId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(200),
});

// --- Inventory ---

export const warehouseStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const stockMovementDirectionSchema = z.enum(['IN', 'OUT']);
export const stockMovementSourceTypeSchema = z.enum([
  'PURCHASE_RECEIPT',
  'SALES_ISSUE',
  'ADJUSTMENT',
  'TRANSFER',
]);
export const inventoryAdjustmentStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'VOID',
  'CANCELLED',
]);

export const warehouseSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable(),
  status: warehouseStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const stockMovementSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  itemName: z.string().min(1),
  sku: z.string().nullable(),
  warehouseId: z.uuid(),
  warehouseName: z.string().min(1),
  movementDate: z.iso.date(),
  direction: stockMovementDirectionSchema,
  quantity: z.string(),
  unitCostMinor: z.string().regex(/^-?\d+$/),
  totalCostMinor: z.string().regex(/^-?\d+$/),
  sourceType: stockMovementSourceTypeSchema,
  sourceId: z.uuid(),
  sourceLineId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export const inventoryAdjustmentSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  itemName: z.string().min(1),
  sku: z.string().nullable(),
  warehouseId: z.uuid(),
  warehouseName: z.string().min(1),
  adjustmentDate: z.iso.date(),
  quantityDelta: z.string(),
  valueDeltaMinor: z.string().regex(/^-?\d+$/),
  reason: z.string().min(1),
  accountId: z.uuid().nullable(),
  status: inventoryAdjustmentStatusSchema,
  journalId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const reorderAdviceSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  itemName: z.string().min(1),
  sku: z.string().nullable(),
  onHand: z.string(),
  reorderThreshold: z.string().nullable(),
  suggestedQuantity: z.string().nullable(),
  preferredVendorId: z.uuid().nullable(),
  preferredVendorName: z.string().nullable(),
});

export const inventoryValuationRowSchema = z.object({
  id: z.string().min(1),
  itemId: z.uuid(),
  itemName: z.string().min(1),
  sku: z.string().nullable(),
  warehouseId: z.uuid(),
  warehouseName: z.string().min(1),
  quantityOnHand: z.string(),
  valueMinor: z.string().regex(/^-?\d+$/),
});

export const inventoryValuationSchema = z.object({
  rows: z.array(inventoryValuationRowSchema),
  totalValueMinor: z.string().regex(/^-?\d+$/),
});

export const warehouseListResponseSchema = z.object({ data: z.array(warehouseSchema) });
export const warehouseResponseSchema = z.object({ data: warehouseSchema });
export const stockMovementListResponseSchema = z.object({ data: z.array(stockMovementSchema) });
export const inventoryAdjustmentListResponseSchema = z.object({
  data: z.array(inventoryAdjustmentSchema),
});
export const inventoryAdjustmentResponseSchema = z.object({ data: inventoryAdjustmentSchema });
export const reorderAdviceResponseSchema = z.object({ data: z.array(reorderAdviceSchema) });
export const inventoryValuationResponseSchema = z.object({ data: inventoryValuationSchema });

export const createWarehouseDto = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  address: z.string().max(240).optional(),
});

export const updateWarehouseDto = createWarehouseDto
  .extend({
    status: warehouseStatusSchema.optional(),
  })
  .partial();

export const createInventoryAdjustmentDto = z.object({
  itemId: z.uuid(),
  warehouseId: z.uuid(),
  adjustmentDate: z.iso.date(),
  quantityDelta: z.string(),
  valueDeltaMinor: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
  reason: z.string().min(1).max(240),
  accountId: z.uuid().optional(),
});

export const updateInventoryAdjustmentDto = createInventoryAdjustmentDto.partial();

export const createInventoryTransferDto = z.object({
  itemId: z.uuid(),
  fromWarehouseId: z.uuid(),
  toWarehouseId: z.uuid(),
  transferDate: z.iso.date(),
  quantity: z.string(),
});

// --- Sales: Recurring Invoices ---

export const recurringCadenceSchema = z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY']);

export const recurringInvoiceTemplateLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  warehouseId: z.uuid().nullable(),
});

export const recurringInvoiceTemplateSchema = z.object({
  id: z.uuid(),
  contactId: z.uuid(),
  contactName: z.string().min(1),
  cadence: recurringCadenceSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  nextRunDate: z.iso.date(),
  autoCreate: z.boolean(),
  autoSend: z.boolean(),
  active: z.boolean(),
  currency: z.string().length(3),
  lastRunOccurrenceKey: z.string().nullable(),
  lines: z.array(recurringInvoiceTemplateLineSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const recurringInvoiceTemplateListResponseSchema = z.object({
  data: z.array(recurringInvoiceTemplateSchema),
});
export const recurringInvoiceTemplateResponseSchema = z.object({
  data: recurringInvoiceTemplateSchema,
});

export const recurringInvoiceTemplateLineDto = z.object({
  itemId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/).optional(),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
});

export const createRecurringInvoiceTemplateDto = z.object({
  contactId: z.uuid(),
  cadence: recurringCadenceSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  currency: z.string().length(3).optional(),
  autoCreate: z.boolean().optional(),
  autoSend: z.boolean().optional(),
  lines: z.array(recurringInvoiceTemplateLineDto).min(1).max(200),
});

export const updateRecurringInvoiceTemplateDto = z.object({
  contactId: z.uuid().optional(),
  cadence: recurringCadenceSchema.optional(),
  endDate: z.iso.date().optional(),
  autoCreate: z.boolean().optional(),
  autoSend: z.boolean().optional(),
  lines: z.array(recurringInvoiceTemplateLineDto).min(1).max(200).optional(),
});

// --- Purchases: Recurring Bills ---

export const recurringBillTemplateLineSchema = z.object({
  id: z.uuid(),
  lineNumber: z.number().int(),
  itemId: z.uuid().nullable(),
  descriptionSnapshot: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/),
  lineTotalMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
  warehouseId: z.uuid().nullable(),
});

export const recurringBillTemplateSchema = z.object({
  id: z.uuid(),
  vendorId: z.uuid(),
  vendorName: z.string().min(1),
  cadence: recurringCadenceSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  nextRunDate: z.iso.date(),
  autoCreate: z.boolean(),
  active: z.boolean(),
  currency: z.string().length(3),
  lastRunOccurrenceKey: z.string().nullable(),
  lines: z.array(recurringBillTemplateLineSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const recurringBillTemplateListResponseSchema = z.object({
  data: z.array(recurringBillTemplateSchema),
});
export const recurringBillTemplateResponseSchema = z.object({ data: recurringBillTemplateSchema });

export const recurringBillTemplateLineDto = z.object({
  itemId: z.uuid().optional(),
  description: z.string().max(240).optional(),
  quantity: z.string(),
  unitPriceMinor: z.string().regex(/^\d+$/),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxCodeId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
});

export const createRecurringBillTemplateDto = z.object({
  vendorId: z.uuid(),
  cadence: recurringCadenceSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  currency: z.string().length(3).optional(),
  autoCreate: z.boolean().optional(),
  lines: z.array(recurringBillTemplateLineDto).min(1).max(200),
});

export const updateRecurringBillTemplateDto = z.object({
  vendorId: z.uuid().optional(),
  cadence: recurringCadenceSchema.optional(),
  endDate: z.iso.date().optional(),
  autoCreate: z.boolean().optional(),
  lines: z.array(recurringBillTemplateLineDto).min(1).max(200).optional(),
});

// --- Purchases: Recurring Expenses ---

export const recurringExpenseTemplateSchema = z.object({
  id: z.uuid(),
  payeeVendorId: z.uuid().nullable(),
  payeeVendorName: z.string().nullable(),
  payeeName: z.string().nullable(),
  cadence: recurringCadenceSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  nextRunDate: z.iso.date(),
  autoCreate: z.boolean(),
  active: z.boolean(),
  paidThroughAccountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
  currency: z.string().length(3),
  amountMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().nullable(),
  lastRunOccurrenceKey: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const recurringExpenseTemplateListResponseSchema = z.object({
  data: z.array(recurringExpenseTemplateSchema),
});
export const recurringExpenseTemplateResponseSchema = z.object({
  data: recurringExpenseTemplateSchema,
});

export const createRecurringExpenseTemplateDto = z.object({
  payeeVendorId: z.uuid().optional(),
  payeeName: z.string().max(160).optional(),
  cadence: recurringCadenceSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  autoCreate: z.boolean().optional(),
  paidThroughAccountId: z.uuid(),
  categoryId: z.uuid().optional(),
  currency: z.string().length(3).optional(),
  amountMinor: z.string().regex(/^\d+$/),
  taxCodeId: z.uuid().optional(),
});

export const updateRecurringExpenseTemplateDto = createRecurringExpenseTemplateDto.partial();

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

export type ContactType = z.infer<typeof contactTypeSchema>;
export type ContactStatus = z.infer<typeof contactStatusSchema>;
export type ContactAddressKind = z.infer<typeof contactAddressKindSchema>;
export type ContactAddress = z.infer<typeof contactAddressSchema>;
export type ContactTaxId = z.infer<typeof contactTaxIdSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type ContactListResponse = z.infer<typeof contactListResponseSchema>;
export type ContactResponse = z.infer<typeof contactResponseSchema>;
export type CreateContactDto = z.infer<typeof createContactDto>;
export type UpdateContactDto = z.infer<typeof updateContactDto>;

export type VendorStatus = z.infer<typeof vendorStatusSchema>;
export type VendorAddressKind = z.infer<typeof vendorAddressKindSchema>;
export type VendorAddress = z.infer<typeof vendorAddressSchema>;
export type VendorTaxId = z.infer<typeof vendorTaxIdSchema>;
export type Vendor = z.infer<typeof vendorSchema>;
export type VendorListResponse = z.infer<typeof vendorListResponseSchema>;
export type VendorResponse = z.infer<typeof vendorResponseSchema>;
export type VendorDuplicateWarning = z.infer<typeof vendorDuplicateWarningSchema>;
export type CreateVendorDto = z.infer<typeof createVendorDto>;
export type UpdateVendorDto = z.infer<typeof updateVendorDto>;

export type ItemType = z.infer<typeof itemTypeSchema>;
export type ItemStatus = z.infer<typeof itemStatusSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Category = z.infer<typeof categorySchema>;
export type ItemPrice = z.infer<typeof itemPriceSchema>;
export type Item = z.infer<typeof itemSchema>;
export type UnitListResponse = z.infer<typeof unitListResponseSchema>;
export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>;
export type ItemListResponse = z.infer<typeof itemListResponseSchema>;
export type ItemResponse = z.infer<typeof itemResponseSchema>;
export type CreateUnitDto = z.infer<typeof createUnitDto>;
export type UpdateUnitDto = z.infer<typeof updateUnitDto>;
export type CreateCategoryDto = z.infer<typeof createCategoryDto>;
export type UpdateCategoryDto = z.infer<typeof updateCategoryDto>;
export type CreateItemDto = z.infer<typeof createItemDto>;
export type UpdateItemDto = z.infer<typeof updateItemDto>;

export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceListResponse = z.infer<typeof invoiceListResponseSchema>;
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;
export type CreateInvoiceDto = z.infer<typeof createInvoiceDto>;
export type UpdateInvoiceDto = z.infer<typeof updateInvoiceDto>;

export type BillStatus = z.infer<typeof billStatusSchema>;
export type BillLine = z.infer<typeof billLineSchema>;
export type Bill = z.infer<typeof billSchema>;
export type BillListResponse = z.infer<typeof billListResponseSchema>;
export type BillResponse = z.infer<typeof billResponseSchema>;
export type CreateBillDto = z.infer<typeof createBillDto>;
export type UpdateBillDto = z.infer<typeof updateBillDto>;

export type OpeningBalanceLine = z.infer<typeof openingBalanceLineSchema>;
export type OpeningBalancePartyLine = z.infer<typeof openingBalancePartyLineSchema>;
export type OpeningBalanceBatch = z.infer<typeof openingBalanceBatchSchema>;
export type OpeningBalanceBatchListResponse = z.infer<typeof openingBalanceBatchListResponseSchema>;
export type OpeningBalanceBatchResponse = z.infer<typeof openingBalanceBatchResponseSchema>;
export type SaveOpeningBalanceBatchDto = z.infer<typeof saveOpeningBalanceBatchDto>;

export type Attachment = z.infer<typeof attachmentSchema>;
export type AttachmentListResponse = z.infer<typeof attachmentListResponseSchema>;
export type AttachmentResponse = z.infer<typeof attachmentResponseSchema>;

export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;
export type ExpenseCategoryListResponse = z.infer<typeof expenseCategoryListResponseSchema>;
export type ExpenseCategoryResponse = z.infer<typeof expenseCategoryResponseSchema>;
export type CreateExpenseCategoryDto = z.infer<typeof createExpenseCategoryDto>;
export type UpdateExpenseCategoryDto = z.infer<typeof updateExpenseCategoryDto>;

export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;
export type Expense = z.infer<typeof expenseSchema>;
export type ExpenseListResponse = z.infer<typeof expenseListResponseSchema>;
export type ExpenseResponse = z.infer<typeof expenseResponseSchema>;
export type CreateExpenseDto = z.infer<typeof createExpenseDto>;
export type UpdateExpenseDto = z.infer<typeof updateExpenseDto>;

export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type PaymentAllocation = z.infer<typeof paymentAllocationSchema>;
export type PaymentReceived = z.infer<typeof paymentReceivedSchema>;
export type PaymentListResponse = z.infer<typeof paymentListResponseSchema>;
export type PaymentResponse = z.infer<typeof paymentResponseSchema>;
export type OpenInvoiceForAllocation = z.infer<typeof openInvoiceForAllocationSchema>;
export type OpenInvoiceListResponse = z.infer<typeof openInvoiceListResponseSchema>;
export type CreatePaymentDto = z.infer<typeof createPaymentDto>;
export type PaymentAllocationLineDto = z.infer<typeof paymentAllocationLineDto>;
export type AllocatePaymentDto = z.infer<typeof allocatePaymentDto>;

export type PaymentMadeAllocation = z.infer<typeof paymentMadeAllocationSchema>;
export type PaymentMade = z.infer<typeof paymentMadeSchema>;
export type PaymentMadeListResponse = z.infer<typeof paymentMadeListResponseSchema>;
export type PaymentMadeResponse = z.infer<typeof paymentMadeResponseSchema>;
export type CreatePaymentMadeDto = z.infer<typeof createPaymentMadeDto>;
export type AllocatePaymentMadeDto = z.infer<typeof allocatePaymentMadeDto>;

export type CreditNoteStatus = z.infer<typeof creditNoteStatusSchema>;
export type CreditNoteLine = z.infer<typeof creditNoteLineSchema>;
export type CreditNoteAllocation = z.infer<typeof creditNoteAllocationSchema>;
export type CreditNoteRefund = z.infer<typeof creditNoteRefundSchema>;
export type CreditNote = z.infer<typeof creditNoteSchema>;
export type CreditNoteListResponse = z.infer<typeof creditNoteListResponseSchema>;
export type CreditNoteResponse = z.infer<typeof creditNoteResponseSchema>;
export type CreateCreditNoteDto = z.infer<typeof createCreditNoteDto>;
export type UpdateCreditNoteDto = z.infer<typeof updateCreditNoteDto>;
export type CreditNoteAllocationLineDto = z.infer<typeof creditNoteAllocationLineDto>;
export type AllocateCreditNoteDto = z.infer<typeof allocateCreditNoteDto>;
export type RefundCreditNoteDto = z.infer<typeof refundCreditNoteDto>;

export type VendorCreditStatus = z.infer<typeof vendorCreditStatusSchema>;
export type VendorCreditLine = z.infer<typeof vendorCreditLineSchema>;
export type VendorCreditAllocation = z.infer<typeof vendorCreditAllocationSchema>;
export type VendorCredit = z.infer<typeof vendorCreditSchema>;
export type VendorCreditListResponse = z.infer<typeof vendorCreditListResponseSchema>;
export type VendorCreditResponse = z.infer<typeof vendorCreditResponseSchema>;
export type CreateVendorCreditDto = z.infer<typeof createVendorCreditDto>;
export type UpdateVendorCreditDto = z.infer<typeof updateVendorCreditDto>;
export type AllocateVendorCreditDto = z.infer<typeof allocateVendorCreditDto>;
export type OpenBillForAllocation = z.infer<typeof openBillForAllocationSchema>;

export type StatementTransactionType = z.infer<typeof statementTransactionTypeSchema>;
export type StatementTransaction = z.infer<typeof statementTransactionSchema>;
export type Statement = z.infer<typeof statementSchema>;
export type StatementResponse = z.infer<typeof statementResponseSchema>;

export type QuoteStatus = z.infer<typeof quoteStatusSchema>;
export type QuoteLine = z.infer<typeof quoteLineSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type QuoteListResponse = z.infer<typeof quoteListResponseSchema>;
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;
export type CreateQuoteDto = z.infer<typeof createQuoteDto>;
export type UpdateQuoteDto = z.infer<typeof updateQuoteDto>;

export type SalesOrderStatus = z.infer<typeof salesOrderStatusSchema>;
export type SalesOrderLine = z.infer<typeof salesOrderLineSchema>;
export type SalesOrder = z.infer<typeof salesOrderSchema>;
export type SalesOrderListResponse = z.infer<typeof salesOrderListResponseSchema>;
export type SalesOrderResponse = z.infer<typeof salesOrderResponseSchema>;
export type CreateSalesOrderDto = z.infer<typeof createSalesOrderDto>;
export type UpdateSalesOrderDto = z.infer<typeof updateSalesOrderDto>;

export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;
export type PurchaseOrderReceiptStatus = z.infer<typeof purchaseOrderReceiptStatusSchema>;
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderListResponse = z.infer<typeof purchaseOrderListResponseSchema>;
export type PurchaseOrderResponse = z.infer<typeof purchaseOrderResponseSchema>;
export type CreatePurchaseOrderDto = z.infer<typeof createPurchaseOrderDto>;
export type UpdatePurchaseOrderDto = z.infer<typeof updatePurchaseOrderDto>;
export type RecordPurchaseOrderReceiptDto = z.infer<typeof recordPurchaseOrderReceiptDto>;

export type InventoryValuationMethod = z.infer<typeof inventoryValuationMethodSchema>;
export type WarehouseStatus = z.infer<typeof warehouseStatusSchema>;
export type StockMovementDirection = z.infer<typeof stockMovementDirectionSchema>;
export type StockMovementSourceType = z.infer<typeof stockMovementSourceTypeSchema>;
export type InventoryAdjustmentStatus = z.infer<typeof inventoryAdjustmentStatusSchema>;
export type Warehouse = z.infer<typeof warehouseSchema>;
export type StockMovement = z.infer<typeof stockMovementSchema>;
export type InventoryAdjustment = z.infer<typeof inventoryAdjustmentSchema>;
export type ReorderAdvice = z.infer<typeof reorderAdviceSchema>;
export type InventoryValuationRow = z.infer<typeof inventoryValuationRowSchema>;
export type InventoryValuation = z.infer<typeof inventoryValuationSchema>;
export type WarehouseListResponse = z.infer<typeof warehouseListResponseSchema>;
export type WarehouseResponse = z.infer<typeof warehouseResponseSchema>;
export type StockMovementListResponse = z.infer<typeof stockMovementListResponseSchema>;
export type InventoryAdjustmentListResponse = z.infer<typeof inventoryAdjustmentListResponseSchema>;
export type InventoryAdjustmentResponse = z.infer<typeof inventoryAdjustmentResponseSchema>;
export type ReorderAdviceResponse = z.infer<typeof reorderAdviceResponseSchema>;
export type InventoryValuationResponse = z.infer<typeof inventoryValuationResponseSchema>;
export type CreateWarehouseDto = z.infer<typeof createWarehouseDto>;
export type UpdateWarehouseDto = z.infer<typeof updateWarehouseDto>;
export type CreateInventoryAdjustmentDto = z.infer<typeof createInventoryAdjustmentDto>;
export type UpdateInventoryAdjustmentDto = z.infer<typeof updateInventoryAdjustmentDto>;
export type CreateInventoryTransferDto = z.infer<typeof createInventoryTransferDto>;

export type RecurringCadence = z.infer<typeof recurringCadenceSchema>;
export type RecurringInvoiceTemplateLine = z.infer<typeof recurringInvoiceTemplateLineSchema>;
export type RecurringInvoiceTemplate = z.infer<typeof recurringInvoiceTemplateSchema>;
export type RecurringInvoiceTemplateListResponse = z.infer<
  typeof recurringInvoiceTemplateListResponseSchema
>;
export type RecurringInvoiceTemplateResponse = z.infer<
  typeof recurringInvoiceTemplateResponseSchema
>;
export type CreateRecurringInvoiceTemplateDto = z.infer<typeof createRecurringInvoiceTemplateDto>;
export type UpdateRecurringInvoiceTemplateDto = z.infer<typeof updateRecurringInvoiceTemplateDto>;

export type RecurringBillTemplateLine = z.infer<typeof recurringBillTemplateLineSchema>;
export type RecurringBillTemplate = z.infer<typeof recurringBillTemplateSchema>;
export type RecurringBillTemplateListResponse = z.infer<
  typeof recurringBillTemplateListResponseSchema
>;
export type RecurringBillTemplateResponse = z.infer<typeof recurringBillTemplateResponseSchema>;
export type CreateRecurringBillTemplateDto = z.infer<typeof createRecurringBillTemplateDto>;
export type UpdateRecurringBillTemplateDto = z.infer<typeof updateRecurringBillTemplateDto>;

export type RecurringExpenseTemplate = z.infer<typeof recurringExpenseTemplateSchema>;
export type RecurringExpenseTemplateListResponse = z.infer<
  typeof recurringExpenseTemplateListResponseSchema
>;
export type RecurringExpenseTemplateResponse = z.infer<
  typeof recurringExpenseTemplateResponseSchema
>;
export type CreateRecurringExpenseTemplateDto = z.infer<typeof createRecurringExpenseTemplateDto>;
export type UpdateRecurringExpenseTemplateDto = z.infer<typeof updateRecurringExpenseTemplateDto>;

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

// --- Phase 5: Banking & Reconciliation ---

export const financialAccountTypeSchema = z.enum(['BANK', 'CASH', 'CREDIT_CARD', 'OTHER']);

export const financialAccountSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  type: financialAccountTypeSchema,
  currency: z.string().length(3),
  glAccountId: z.uuid(),
  openingBalanceMinor: z.string().regex(/^-?\d+$/),
  active: z.boolean(),
  lastActivityAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const financialAccountListResponseSchema = z.object({
  data: z.array(financialAccountSchema),
});
export const financialAccountResponseSchema = z.object({ data: financialAccountSchema });

export const createFinancialAccountDto = z.object({
  name: z.string().min(1).max(120),
  type: financialAccountTypeSchema,
  currency: z.string().length(3),
  glAccountId: z.uuid(),
  openingBalanceMinor: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
});

export const updateFinancialAccountDto = z.object({
  name: z.string().min(1).max(120).optional(),
  type: financialAccountTypeSchema.optional(),
  currency: z.string().length(3).optional(),
  glAccountId: z.uuid().optional(),
  active: z.boolean().optional(),
});

export const bankRuleFieldSchema = z.enum(['description', 'reference', 'amountMinor', 'direction']);
export const bankRuleOperatorSchema = z.enum(['contains', 'equals', 'gt', 'gte', 'lt', 'lte']);

export const bankRuleConditionSchema = z.object({
  field: bankRuleFieldSchema,
  operator: bankRuleOperatorSchema,
  value: z.string().min(1),
});

export const bankRuleSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  priority: z.number().int(),
  active: z.boolean(),
  matchAny: z.boolean(),
  conditions: z.array(bankRuleConditionSchema),
  suggestAccountId: z.uuid().nullable(),
  suggestContactId: z.uuid().nullable(),
  suggestVendorId: z.uuid().nullable(),
  suggestTags: z.array(z.string()),
  stopOnMatch: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const bankRuleListResponseSchema = z.object({ data: z.array(bankRuleSchema) });
export const bankRuleResponseSchema = z.object({ data: bankRuleSchema });

export const createBankRuleDto = z.object({
  name: z.string().min(1).max(120),
  priority: z.number().int().min(1).max(10_000),
  matchAny: z.boolean().optional(),
  conditions: z.array(bankRuleConditionSchema).max(20),
  suggestAccountId: z.uuid().optional(),
  suggestContactId: z.uuid().optional(),
  suggestVendorId: z.uuid().optional(),
  suggestTags: z.array(z.string()).max(20).optional(),
  stopOnMatch: z.boolean().optional(),
});

export const updateBankRuleDto = createBankRuleDto.partial().extend({
  active: z.boolean().optional(),
});

export const statementImportFormatSchema = z.enum(['CSV']);
export const statementImportStatusSchema = z.enum(['IMPORTED', 'PARTIALLY_IMPORTED', 'FAILED']);

export const statementImportSchema = z.object({
  id: z.uuid(),
  financialAccountId: z.uuid(),
  format: statementImportFormatSchema,
  status: statementImportStatusSchema,
  fileName: z.string(),
  totalRows: z.number().int(),
  importedCount: z.number().int(),
  duplicateCount: z.number().int(),
  failedCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const statementImportListResponseSchema = z.object({ data: z.array(statementImportSchema) });
export const statementImportResponseSchema = z.object({ data: statementImportSchema });

export const statementImportRowOutcomeSchema = z.object({
  rowNumber: z.number().int(),
  date: z.string().nullable(),
  description: z.string().nullable(),
  reference: z.string().nullable(),
  amount: z.string().nullable(),
  outcome: z.enum(['IMPORTED', 'DUPLICATE', 'FAILED']),
  error: z.string().optional(),
  bankTransactionId: z.uuid().optional(),
});

export const statementImportFailedRowsResponseSchema = z.object({
  data: z.array(statementImportRowOutcomeSchema),
});

export const bankTransactionDirectionSchema = z.enum(['INFLOW', 'OUTFLOW']);
export const bankTransactionDispositionSchema = z.enum([
  'UNRESOLVED',
  'MATCHED',
  'POSTED',
  'EXCLUDED',
]);
export const matchTargetTypeSchema = z.enum([
  'PAYMENT_RECEIVED',
  'PAYMENT_MADE',
  'EXPENSE',
  'TRANSFER',
]);

export const matchSchema = z.object({
  id: z.uuid(),
  targetType: matchTargetTypeSchema,
  targetId: z.uuid(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const bankTransactionSchema = z.object({
  id: z.uuid(),
  financialAccountId: z.uuid(),
  statementImportId: z.uuid().nullable(),
  transactionDate: z.iso.date(),
  description: z.string(),
  reference: z.string().nullable(),
  direction: bankTransactionDirectionSchema,
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  disposition: bankTransactionDispositionSchema,
  excludeReason: z.string().nullable(),
  suggestedAccountId: z.uuid().nullable(),
  suggestedContactId: z.uuid().nullable(),
  suggestedVendorId: z.uuid().nullable(),
  suggestedTags: z.array(z.string()),
  appliedFromRuleId: z.uuid().nullable(),
  postedJournalId: z.uuid().nullable(),
  match: matchSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const bankTransactionListResponseSchema = z.object({ data: z.array(bankTransactionSchema) });
export const bankTransactionResponseSchema = z.object({ data: bankTransactionSchema });

export const categorizeLineDto = z.object({
  accountId: z.uuid(),
  amountMinor: z.string().regex(/^\d+$/),
  description: z.string().max(240).optional(),
});

export const categorizeBankTransactionDto = z.object({
  lines: z.array(categorizeLineDto).min(1).max(50),
});

export const excludeBankTransactionDto = z.object({
  reason: z.string().min(1).max(240),
});

export const matchBankTransactionDto = z.object({
  targetType: matchTargetTypeSchema,
  targetId: z.uuid(),
  note: z.string().max(240).optional(),
});

export const transferStatusSchema = z.enum(['POSTED', 'VOID']);

export const transferSchema = z.object({
  id: z.uuid(),
  transferNumber: z.string().nullable(),
  status: transferStatusSchema,
  transferDate: z.iso.date(),
  description: z.string().nullable(),
  fromFinancialAccountId: z.uuid(),
  toFinancialAccountId: z.uuid(),
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  fromAmountMinor: z.string().regex(/^\d+$/),
  toAmountMinor: z.string().regex(/^\d+$/),
  exchangeRate: z.string().nullable(),
  journalId: z.uuid(),
  voidedAt: z.iso.datetime().nullable(),
  voidJournalId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const transferListResponseSchema = z.object({ data: z.array(transferSchema) });
export const transferResponseSchema = z.object({ data: transferSchema });

export const createTransferDto = z.object({
  fromFinancialAccountId: z.uuid(),
  toFinancialAccountId: z.uuid(),
  transferDate: z.iso.date(),
  fromAmountMinor: z.string().regex(/^\d+$/),
  toAmountMinor: z.string().regex(/^\d+$/),
  description: z.string().max(240).optional(),
});

export const reconciliationStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETED']);

export const reconciliationSchema = z.object({
  id: z.uuid(),
  financialAccountId: z.uuid(),
  statementStartDate: z.iso.date(),
  statementEndDate: z.iso.date(),
  openingBalanceMinor: z.string().regex(/^-?\d+$/),
  closingBalanceMinor: z.string().regex(/^-?\d+$/),
  status: reconciliationStatusSchema,
  completedAt: z.iso.datetime().nullable(),
  completedByUserId: z.uuid().nullable(),
  reopenedAt: z.iso.datetime().nullable(),
  reopenedByUserId: z.uuid().nullable(),
  reopenReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const reconciliationDetailSchema = reconciliationSchema.extend({
  difference: z.string().regex(/^-?\d+$/),
  clearedTransactionIds: z.array(z.uuid()),
});

export const reconciliationListResponseSchema = z.object({ data: z.array(reconciliationSchema) });
export const reconciliationResponseSchema = z.object({ data: reconciliationDetailSchema });

export const startReconciliationDto = z.object({
  financialAccountId: z.uuid(),
  statementStartDate: z.iso.date(),
  statementEndDate: z.iso.date(),
  openingBalanceMinor: z.string().regex(/^-?\d+$/),
  closingBalanceMinor: z.string().regex(/^-?\d+$/),
});

export const setClearedTransactionsDto = z.object({
  transactionIds: z.array(z.uuid()).min(1).max(500),
});

export const reopenReconciliationDto = z.object({
  reason: z.string().min(1).max(240),
});

export type FinancialAccountType = z.infer<typeof financialAccountTypeSchema>;
export type FinancialAccount = z.infer<typeof financialAccountSchema>;
export type FinancialAccountListResponse = z.infer<typeof financialAccountListResponseSchema>;
export type FinancialAccountResponse = z.infer<typeof financialAccountResponseSchema>;
export type CreateFinancialAccountDto = z.infer<typeof createFinancialAccountDto>;
export type UpdateFinancialAccountDto = z.infer<typeof updateFinancialAccountDto>;

export type BankRuleField = z.infer<typeof bankRuleFieldSchema>;
export type BankRuleOperator = z.infer<typeof bankRuleOperatorSchema>;
export type BankRuleCondition = z.infer<typeof bankRuleConditionSchema>;
export type BankRule = z.infer<typeof bankRuleSchema>;
export type BankRuleListResponse = z.infer<typeof bankRuleListResponseSchema>;
export type BankRuleResponse = z.infer<typeof bankRuleResponseSchema>;
export type CreateBankRuleDto = z.infer<typeof createBankRuleDto>;
export type UpdateBankRuleDto = z.infer<typeof updateBankRuleDto>;

export type StatementImportFormat = z.infer<typeof statementImportFormatSchema>;
export type StatementImportStatus = z.infer<typeof statementImportStatusSchema>;
export type StatementImport = z.infer<typeof statementImportSchema>;
export type StatementImportListResponse = z.infer<typeof statementImportListResponseSchema>;
export type StatementImportResponse = z.infer<typeof statementImportResponseSchema>;
export type StatementImportRowOutcome = z.infer<typeof statementImportRowOutcomeSchema>;
export type StatementImportFailedRowsResponse = z.infer<
  typeof statementImportFailedRowsResponseSchema
>;

export type BankTransactionDirection = z.infer<typeof bankTransactionDirectionSchema>;
export type BankTransactionDisposition = z.infer<typeof bankTransactionDispositionSchema>;
export type MatchTargetType = z.infer<typeof matchTargetTypeSchema>;
export type Match = z.infer<typeof matchSchema>;
export type BankTransaction = z.infer<typeof bankTransactionSchema>;
export type BankTransactionListResponse = z.infer<typeof bankTransactionListResponseSchema>;
export type BankTransactionResponse = z.infer<typeof bankTransactionResponseSchema>;
export type CategorizeLineDto = z.infer<typeof categorizeLineDto>;
export type CategorizeBankTransactionDto = z.infer<typeof categorizeBankTransactionDto>;
export type ExcludeBankTransactionDto = z.infer<typeof excludeBankTransactionDto>;
export type MatchBankTransactionDto = z.infer<typeof matchBankTransactionDto>;

export type TransferStatus = z.infer<typeof transferStatusSchema>;
export type Transfer = z.infer<typeof transferSchema>;
export type TransferListResponse = z.infer<typeof transferListResponseSchema>;
export type TransferResponse = z.infer<typeof transferResponseSchema>;
export type CreateTransferDto = z.infer<typeof createTransferDto>;

export type ReconciliationStatus = z.infer<typeof reconciliationStatusSchema>;
export type Reconciliation = z.infer<typeof reconciliationSchema>;
export type ReconciliationDetail = z.infer<typeof reconciliationDetailSchema>;
export type ReconciliationListResponse = z.infer<typeof reconciliationListResponseSchema>;
export type ReconciliationResponse = z.infer<typeof reconciliationResponseSchema>;
export type StartReconciliationDto = z.infer<typeof startReconciliationDto>;
export type SetClearedTransactionsDto = z.infer<typeof setClearedTransactionsDto>;
export type ReopenReconciliationDto = z.infer<typeof reopenReconciliationDto>;

// --- Projects & Time ---

export const projectStatusSchema = z.enum(['OPEN', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);
export const projectBillingMethodSchema = z.enum([
  'TIME_AND_MATERIALS',
  'FIXED_PRICE',
  'NON_BILLABLE',
]);
export const projectTaskStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'DONE']);
export const timeEntryStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'INVOICED',
]);
export const tagStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);

const minorAmount = z.string().regex(/^-?\d+$/);
/** Decimal hours, e.g. "7.50". Two places, matching `TimeEntry.hours`. */
const hoursString = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

export const tagSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  status: tagStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const projectSchema = z.object({
  id: z.uuid(),
  code: z.string().nullable(),
  name: z.string().min(1),
  customerId: z.uuid().nullable(),
  customerName: z.string().nullable(),
  managerUserId: z.uuid().nullable(),
  managerName: z.string().nullable(),
  status: projectStatusSchema,
  billingMethod: projectBillingMethodSchema,
  currency: z.string().length(3),
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  budgetAmountMinor: minorAmount.nullable(),
  budgetHours: z.string().nullable(),
  defaultRateMinor: minorAmount.nullable(),
  description: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const projectTaskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string().min(1),
  assigneeUserId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  status: projectTaskStatusSchema,
  estimateHours: z.string().nullable(),
  billableDefault: z.boolean(),
  rateMinor: minorAmount.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const timeEntrySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  projectName: z.string().min(1),
  taskId: z.uuid().nullable(),
  taskName: z.string().nullable(),
  userId: z.uuid(),
  userName: z.string().min(1),
  entryDate: z.iso.date(),
  hours: z.string(),
  billable: z.boolean(),
  rateMinor: minorAmount.nullable(),
  costRateMinor: minorAmount.nullable(),
  amountMinor: minorAmount,
  note: z.string().nullable(),
  status: timeEntryStatusSchema,
  submittedAt: z.iso.datetime().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  decisionComment: z.string().nullable(),
  invoiceLineId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const projectExpenseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  expenseId: z.uuid(),
  expenseNumber: z.string().nullable(),
  expenseDate: z.iso.date(),
  payeeName: z.string().nullable(),
  amountMinor: minorAmount,
  billable: z.boolean(),
  markupPercent: z.string().nullable(),
  billableAmountMinor: minorAmount,
  invoiceLineId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const projectBudgetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid(),
  taskName: z.string().min(1),
  budgetHours: z.string().nullable(),
  budgetAmountMinor: minorAmount.nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * Everything the profitability view reports, with the ledger figures separated from the
 * work-in-progress ones. `revenueMinor` and `costMinor` come from posted journal lines carrying
 * this project's dimension, so they tie to the P&L; `unbilled*` are pipeline, not ledger.
 */
export const projectProfitabilitySchema = z.object({
  projectId: z.uuid(),
  projectName: z.string().min(1),
  currency: z.string().length(3),
  revenueMinor: minorAmount,
  costMinor: minorAmount,
  marginMinor: minorAmount,
  marginPercent: z.string().nullable(),
  billedHours: z.string(),
  unbilledHours: z.string(),
  unbilledTimeMinor: minorAmount,
  unbilledExpenseMinor: minorAmount,
  budgetAmountMinor: minorAmount.nullable(),
  budgetHours: z.string().nullable(),
});

/** One invoiceable line the generate-invoice flow would create, previewed before it commits. */
export const projectBillableSchema = z.object({
  sourceType: z.enum(['TIME', 'EXPENSE']),
  sourceId: z.uuid(),
  description: z.string().min(1),
  quantity: z.string(),
  unitPriceMinor: minorAmount,
  lineTotalMinor: minorAmount,
});

export const createProjectDto = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(40).optional(),
  customerId: z.uuid().optional(),
  managerUserId: z.uuid().optional(),
  billingMethod: projectBillingMethodSchema.optional(),
  currency: z.string().length(3).optional(),
  startsOn: z.iso.date().optional(),
  endsOn: z.iso.date().optional(),
  budgetAmountMinor: minorAmount.optional(),
  budgetHours: hoursString.optional(),
  defaultRateMinor: minorAmount.optional(),
  description: z.string().max(500).optional(),
});

export const updateProjectDto = createProjectDto.partial();

export const changeProjectStatusDto = z.object({
  status: projectStatusSchema,
  reason: z.string().max(240).optional(),
});

export const createProjectTaskDto = z.object({
  name: z.string().min(1).max(160),
  assigneeUserId: z.uuid().optional(),
  status: projectTaskStatusSchema.optional(),
  estimateHours: hoursString.optional(),
  billableDefault: z.boolean().optional(),
  rateMinor: minorAmount.optional(),
});

export const updateProjectTaskDto = createProjectTaskDto.partial();

export const createTimeEntryDto = z.object({
  projectId: z.uuid(),
  taskId: z.uuid().optional(),
  userId: z.uuid().optional(),
  entryDate: z.iso.date(),
  hours: hoursString,
  billable: z.boolean().optional(),
  rateMinor: minorAmount.optional(),
  costRateMinor: minorAmount.optional(),
  note: z.string().max(500).optional(),
});

export const updateTimeEntryDto = createTimeEntryDto.partial().omit({ projectId: true });

export const timeDecisionDto = z.object({
  timeEntryIds: z.array(z.uuid()).min(1).max(500),
  comment: z.string().max(500).optional(),
});

export const linkProjectExpenseDto = z.object({
  expenseId: z.uuid(),
  billable: z.boolean().optional(),
  markupPercent: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,4})?$/)
    .optional(),
});

export const updateProjectExpenseDto = linkProjectExpenseDto.partial().omit({ expenseId: true });

export const upsertProjectBudgetDto = z.object({
  taskId: z.uuid(),
  budgetHours: hoursString.optional(),
  budgetAmountMinor: minorAmount.optional(),
  note: z.string().max(240).optional(),
});

export const generateProjectInvoiceDto = z.object({
  timeEntryIds: z.array(z.uuid()).max(500).optional(),
  projectExpenseIds: z.array(z.uuid()).max(500).optional(),
  issueDate: z.iso.date().optional(),
  dueDate: z.iso.date().optional(),
  issue: z.boolean().optional(),
});

export const createTagDto = z.object({
  name: z.string().min(1).max(80),
});

export const updateTagDto = z.object({
  name: z.string().min(1).max(80).optional(),
  status: tagStatusSchema.optional(),
});

export const projectListResponseSchema = z.object({ data: z.array(projectSchema) });
export const projectResponseSchema = z.object({ data: projectSchema });
export const projectTaskListResponseSchema = z.object({ data: z.array(projectTaskSchema) });
export const projectTaskResponseSchema = z.object({ data: projectTaskSchema });
export const timeEntryListResponseSchema = z.object({ data: z.array(timeEntrySchema) });
export const timeEntryResponseSchema = z.object({ data: timeEntrySchema });
export const projectExpenseListResponseSchema = z.object({
  data: z.array(projectExpenseSchema),
});
export const projectExpenseResponseSchema = z.object({ data: projectExpenseSchema });
export const projectBudgetListResponseSchema = z.object({ data: z.array(projectBudgetSchema) });
export const projectBudgetResponseSchema = z.object({ data: projectBudgetSchema });
export const projectProfitabilityResponseSchema = z.object({ data: projectProfitabilitySchema });
export const projectBillableListResponseSchema = z.object({
  data: z.array(projectBillableSchema),
});
export const tagListResponseSchema = z.object({ data: z.array(tagSchema) });
export const tagResponseSchema = z.object({ data: tagSchema });

export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ProjectBillingMethod = z.infer<typeof projectBillingMethodSchema>;
export type ProjectTaskStatus = z.infer<typeof projectTaskStatusSchema>;
export type TimeEntryStatus = z.infer<typeof timeEntryStatusSchema>;
export type TagStatus = z.infer<typeof tagStatusSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectTask = z.infer<typeof projectTaskSchema>;
export type TimeEntry = z.infer<typeof timeEntrySchema>;
export type ProjectExpense = z.infer<typeof projectExpenseSchema>;
export type ProjectBudget = z.infer<typeof projectBudgetSchema>;
export type ProjectProfitability = z.infer<typeof projectProfitabilitySchema>;
export type ProjectBillable = z.infer<typeof projectBillableSchema>;
export type CreateProjectDto = z.infer<typeof createProjectDto>;
export type UpdateProjectDto = z.infer<typeof updateProjectDto>;
export type ChangeProjectStatusDto = z.infer<typeof changeProjectStatusDto>;
export type CreateProjectTaskDto = z.infer<typeof createProjectTaskDto>;
export type UpdateProjectTaskDto = z.infer<typeof updateProjectTaskDto>;
export type CreateTimeEntryDto = z.infer<typeof createTimeEntryDto>;
export type UpdateTimeEntryDto = z.infer<typeof updateTimeEntryDto>;
export type TimeDecisionDto = z.infer<typeof timeDecisionDto>;
export type LinkProjectExpenseDto = z.infer<typeof linkProjectExpenseDto>;
export type UpdateProjectExpenseDto = z.infer<typeof updateProjectExpenseDto>;
export type UpsertProjectBudgetDto = z.infer<typeof upsertProjectBudgetDto>;
export type GenerateProjectInvoiceDto = z.infer<typeof generateProjectInvoiceDto>;
export type CreateTagDto = z.infer<typeof createTagDto>;
export type UpdateTagDto = z.infer<typeof updateTagDto>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export type ProjectTaskListResponse = z.infer<typeof projectTaskListResponseSchema>;
export type ProjectTaskResponse = z.infer<typeof projectTaskResponseSchema>;
export type TimeEntryListResponse = z.infer<typeof timeEntryListResponseSchema>;
export type TimeEntryResponse = z.infer<typeof timeEntryResponseSchema>;
export type ProjectExpenseListResponse = z.infer<typeof projectExpenseListResponseSchema>;
export type ProjectExpenseResponse = z.infer<typeof projectExpenseResponseSchema>;
export type ProjectBudgetListResponse = z.infer<typeof projectBudgetListResponseSchema>;
export type ProjectBudgetResponse = z.infer<typeof projectBudgetResponseSchema>;
export type ProjectProfitabilityResponse = z.infer<typeof projectProfitabilityResponseSchema>;
export type ProjectBillableListResponse = z.infer<typeof projectBillableListResponseSchema>;
export type TagListResponse = z.infer<typeof tagListResponseSchema>;
export type TagResponse = z.infer<typeof tagResponseSchema>;
