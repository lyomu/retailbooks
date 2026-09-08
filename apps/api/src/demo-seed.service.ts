import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountingBasis,
  BusinessType,
  NumberingReset,
  OrganizationStatus,
  TaxTreatment,
} from '@prisma/client';

import { hashIdentifier } from './auth/auth.crypto.js';
import { AuthService, type PublicUser } from './auth/auth.service.js';
import type { RequestMetadata } from './auth/request-context.js';
import { PrismaService } from './database/prisma.service.js';
import { EmailQueueService } from './jobs/email-queue.service.js';
import { CurrencyService } from './organizations/currency.service.js';
import { FiscalPeriodsService } from './organizations/fiscal-periods.service.js';
import { SYSTEM_ACCOUNT_KEYS } from './organizations/ledger-starter-chart.js';
import { LedgerService } from './organizations/ledger.service.js';
import { OrganizationAccessService } from './organizations/organization-access.service.js';
import type { OrganizationContext } from './organizations/organization-context.js';
import { OrganizationMembersService } from './organizations/organization-members.service.js';
import { OrganizationService } from './organizations/organization.service.js';
import { RolesService } from './organizations/roles.service.js';
import { TaxService } from './organizations/tax.service.js';
import { CustomersService } from './sales/customers.service.js';
import { InvoicesService } from './sales/invoices.service.js';
import { QuotesService } from './sales/quotes.service.js';

const DEMO_ORGANIZATION = 'RetailBooks Demo Company Ltd';
const DEMO_PASSWORD = 'DemoRetailBooks1!';
const FISCAL_YEAR_START = '2026-01-01';
const RATE_DATE = '2026-08-01';
const SOURCE_TYPE = 'DEMO_SEED';

const DEMO_USERS = [
  { key: 'OWNER', displayName: 'Amina Kamau', email: 'demo.owner@retailbooks.local' },
  { key: 'ADMIN', displayName: 'Daniel Otieno', email: 'demo.admin@retailbooks.local' },
  {
    key: 'ACCOUNTANT',
    displayName: 'Grace Wanjiku',
    email: 'demo.accountant@retailbooks.local',
  },
  { key: 'SALES', displayName: 'Musa Kiptoo', email: 'demo.sales@retailbooks.local' },
  { key: 'VIEWER', displayName: 'Njeri Auditor', email: 'demo.viewer@retailbooks.local' },
] as const;

/**
 * The Phase 11 portal demo: one customer, the documents a customer would actually be shown, and a
 * signed-in portal identity holding a grant to them. Seeding it here is what lets the portal be
 * demonstrated and browser-tested at all -- the grant is the only way into `/portal`, and it cannot
 * be reached by signing up.
 */
const DEMO_PORTAL_USER = {
  displayName: 'Zawadi Mwangi',
  email: 'demo.customer@retailbooks.local',
} as const;
const DEMO_PORTAL_CUSTOMER = 'Karibu Wholesale Ltd';

@Injectable()
export class DemoSeedService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly organizations: OrganizationService,
    private readonly access: OrganizationAccessService,
    private readonly members: OrganizationMembersService,
    private readonly roles: RolesService,
    private readonly periods: FiscalPeriodsService,
    private readonly currencies: CurrencyService,
    private readonly tax: TaxService,
    private readonly ledger: LedgerService,
    private readonly emailQueue: EmailQueueService,
    private readonly customers: CustomersService,
    private readonly invoices: InvoicesService,
    private readonly quotes: QuotesService,
  ) {}

  async run() {
    if (
      this.config.get('NODE_ENV') === 'production' &&
      this.config.get('ALLOW_DEMO_SEED') !== 'true'
    ) {
      throw new Error('Refusing to seed demo data in production without ALLOW_DEMO_SEED=true.');
    }

    const metadata: RequestMetadata = {
      ipHash: hashIdentifier('demo-seed', this.auth.pepper),
      userAgent: 'RetailBooks demo seed',
    };
    const users = new Map<string, PublicUser>();
    for (const definition of DEMO_USERS) {
      users.set(
        definition.key,
        await this.auth.provisionVerifiedUserForBootstrap(
          {
            displayName: definition.displayName,
            email: definition.email,
            password: DEMO_PASSWORD,
          },
          metadata,
        ),
      );
    }
    const owner = required(users.get('OWNER'), 'Demo owner was not provisioned.');

    let organization = await this.prisma.organization.findFirst({
      where: { legalName: DEMO_ORGANIZATION, createdByUserId: owner.id },
      select: { id: true, status: true },
    });
    if (!organization) {
      const created = await this.organizations.create(
        owner,
        {
          legalName: DEMO_ORGANIZATION,
          tradingName: 'Karibu Retail Demo',
          businessType: BusinessType.LIMITED_COMPANY,
          countryCode: 'KE',
        },
        metadata,
      );
      organization = { id: created.id, status: created.status };
    }
    if (organization.status === OrganizationStatus.SUSPENDED) {
      throw new Error('The demo organization is suspended and cannot be reseeded.');
    }

    if (organization.status === OrganizationStatus.DRAFT) {
      await this.configureAndFinalize(organization.id, owner, metadata);
    }
    const context = await this.access.requireMembership(owner.id, organization.id);

    await this.ensureMembers(context, owner, users, metadata);
    await this.ensureFiscalYear(context, owner, metadata);
    await this.ensureCurrencies(context, owner, metadata);
    const taxCodeId = await this.ensureTaxes(context, owner, metadata);
    await this.ensureJournals(context, owner, taxCodeId, metadata);
    await this.ensurePortalDemo(context, owner, metadata);

    return this.verify(context.id);
  }

  private async configureAndFinalize(
    organizationId: string,
    owner: PublicUser,
    metadata: RequestMetadata,
  ): Promise<void> {
    const updates = [
      {
        section: 'PROFILE' as const,
        tradingName: 'Karibu Retail Demo',
        businessType: BusinessType.LIMITED_COMPANY,
      },
      {
        section: 'ACCOUNTING' as const,
        accountingBasis: AccountingBasis.ACCRUAL,
        chartTemplate: 'retail',
        booksStartDate: FISCAL_YEAR_START,
      },
      {
        section: 'TAX' as const,
        taxRegistered: true,
        taxIdentifier: 'P051234567D',
        defaultTaxTreatment: TaxTreatment.EXCLUSIVE,
        defaultTaxRate: 16,
      },
      {
        section: 'NUMBERING' as const,
        journalPrefix: 'DEMO',
        numberPadding: 5,
        nextJournalNumber: 1,
        numberingReset: NumberingReset.ANNUAL,
      },
      { section: 'REVIEW' as const },
    ];
    for (const update of updates) {
      const context = await this.access.requireMembership(owner.id, organizationId);
      await this.organizations.updateSection(context, owner, update, metadata);
    }
    const context = await this.access.requireMembership(owner.id, organizationId);
    await this.organizations.finalize(context, owner, metadata);
  }

  private async ensureMembers(
    context: OrganizationContext,
    owner: PublicUser,
    users: ReadonlyMap<string, PublicUser>,
    metadata: RequestMetadata,
  ): Promise<void> {
    const { roles } = await this.roles.listRoles(context.id);
    const roleByKey = new Map(roles.map((role) => [role.key, role]));
    for (const definition of DEMO_USERS.filter((item) => item.key !== 'OWNER')) {
      const user = required(users.get(definition.key), `Missing demo user ${definition.key}.`);
      const role = required(roleByKey.get(definition.key), `Missing role ${definition.key}.`);
      const membership = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: context.id, userId: user.id } },
        include: { role: { select: { key: true } } },
      });
      if (!membership) {
        const issued = await this.members.issueInvitationForBootstrap(
          context,
          owner,
          { email: user.email, roleId: role.id },
          metadata,
        );
        await this.organizations.acceptInvitation(issued.rawToken, user, metadata);
      } else if (membership.role.key !== definition.key) {
        await this.members.updateMember(
          context,
          owner,
          membership.id,
          { roleId: role.id },
          metadata,
        );
      }
    }
  }

  private async ensureFiscalYear(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
  ): Promise<void> {
    const exists = await this.prisma.fiscalYear.findFirst({
      where: {
        organizationId: context.id,
        startsOn: new Date(`${FISCAL_YEAR_START}T00:00:00.000Z`),
      },
      select: { id: true },
    });
    if (!exists) {
      await this.periods.generateFiscalYear(
        context,
        owner,
        { startsOn: FISCAL_YEAR_START },
        metadata,
      );
    }
  }

  private async ensureCurrencies(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
  ): Promise<void> {
    for (const currencyCode of ['USD', 'EUR']) {
      const existing = await this.prisma.organizationCurrency.findUnique({
        where: {
          organizationId_currencyCode: { organizationId: context.id, currencyCode },
        },
      });
      if (!existing?.enabled) {
        await this.currencies.enable(context, owner, { currencyCode }, metadata);
      }
    }
    for (const rate of [
      { quoteCurrency: 'USD', rate: '129.5000000000' },
      { quoteCurrency: 'EUR', rate: '151.2500000000' },
    ]) {
      const existing = await this.prisma.exchangeRate.findUnique({
        where: {
          organizationId_baseCurrency_quoteCurrency_rateDate: {
            organizationId: context.id,
            baseCurrency: 'KES',
            quoteCurrency: rate.quoteCurrency,
            rateDate: new Date(`${RATE_DATE}T00:00:00.000Z`),
          },
        },
      });
      if (!existing) {
        await this.currencies.upsertRate(
          context,
          owner,
          { ...rate, rateDate: RATE_DATE, source: 'DEMO_SEED' },
          metadata,
        );
      }
    }
  }

  private async ensureTaxes(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
  ): Promise<string> {
    const taxCodes = await this.tax.listTaxCodes(context.id);
    const standard = required(
      taxCodes.find((code) => code.code === 'VAT-STD'),
      'The Kenya VAT-STD starter code was not created.',
    );
    const zero = required(
      taxCodes.find((code) => code.code === 'VAT-ZERO'),
      'The Kenya VAT-ZERO starter code was not created.',
    );
    for (const [code, ratePercent] of [
      [standard, '16.0000'],
      [zero, '0.0000'],
    ] as const) {
      const rate = await this.prisma.taxRate.findFirst({
        where: { organizationId: context.id, taxCodeId: code.id },
      });
      if (!rate) {
        await this.tax.createRate(
          context,
          owner,
          code.id,
          { ratePercent, effectiveFrom: FISCAL_YEAR_START },
          metadata,
        );
      }
    }
    return standard.id;
  }

  private async ensureJournals(
    context: OrganizationContext,
    owner: PublicUser,
    taxCodeId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const [bank, revenue, expense] = await Promise.all([
      this.ledger.accountBySystemKey(context.id, 'bank_default'),
      this.ledger.accountBySystemKey(context.id, 'sales_revenue'),
      this.ledger.accountBySystemKey(context.id, 'general_expense'),
    ]);

    await this.ensurePostedJournal(
      context,
      owner,
      'taxed-sale',
      {
        journalDate: '2026-08-15',
        currency: 'KES',
        description: 'Demo cash sale with VAT snapshot',
        sourceType: SOURCE_TYPE,
        sourceId: 'taxed-sale',
        lines: [
          {
            accountId: bank.id,
            description: 'Cash received',
            debitMinor: '116000',
            creditMinor: '0',
          },
          {
            accountId: revenue.id,
            description: 'Retail sale',
            debitMinor: '0',
            creditMinor: '116000',
            taxCodeId,
          },
        ],
      },
      metadata,
    );

    const reversible = await this.ensurePostedJournal(
      context,
      owner,
      'reversible-expense',
      {
        journalDate: '2026-08-20',
        currency: 'KES',
        description: 'Demo expense corrected by reversal',
        sourceType: SOURCE_TYPE,
        sourceId: 'reversible-expense',
        lines: [
          {
            accountId: expense.id,
            description: 'Office supplies entered in error',
            debitMinor: '45000',
            creditMinor: '0',
          },
          {
            accountId: bank.id,
            description: 'Bank payment entered in error',
            debitMinor: '0',
            creditMinor: '45000',
          },
        ],
      },
      metadata,
    );
    const reversed = await this.prisma.journal.findUnique({
      where: { id: reversible.id },
      select: { status: true, reversalJournal: { select: { id: true } } },
    });
    if (!reversed?.reversalJournal) {
      await this.ledger.reverseJournal(
        context,
        owner,
        reversible.id,
        {
          journalDate: '2026-08-21',
          description: 'Correct the demo office-supplies entry',
          idempotencyKey: 'demo-seed:reverse:reversible-expense',
        },
        metadata,
      );
    }

    await this.ensurePostedJournal(
      context,
      owner,
      'foreign-sale',
      {
        journalDate: '2026-08-22',
        currency: 'USD',
        description: 'Demo USD settlement with an FX gain',
        sourceType: SOURCE_TYPE,
        sourceId: 'foreign-sale',
        lines: [
          {
            accountId: bank.id,
            description: 'USD 100 deposited',
            debitMinor: '1',
            creditMinor: '0',
            foreignAmountMinor: '10000',
          },
          {
            accountId: revenue.id,
            description: 'Sale recognized in base currency',
            debitMinor: '0',
            creditMinor: '1294900',
          },
        ],
      },
      metadata,
    );
  }

  private async ensurePostedJournal(
    context: OrganizationContext,
    owner: PublicUser,
    sourceId: string,
    input: Parameters<LedgerService['createJournalDraft']>[2],
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.journal.findFirst({
      where: { organizationId: context.id, sourceType: SOURCE_TYPE, sourceId },
      select: { id: true },
    });
    if (existing) return this.ledger.getJournal(context.id, existing.id);
    const draft = await this.ledger.createJournalDraft(context, owner, input);
    return this.ledger.postJournal(
      context,
      owner,
      draft.id,
      metadata,
      `demo-seed:post:${sourceId}`,
    );
  }

  /**
   * Seeds the customer-portal demo. The grant is written directly rather than by redeeming an
   * invitation: the token exists only in the invitation email, so a seed cannot replay the flow --
   * invitation issue, binding, expiry, replay and revocation are covered by the integration suite
   * instead. What the seed guarantees is the *end state* an accepted invitation produces.
   */
  private async ensurePortalDemo(
    context: OrganizationContext,
    owner: PublicUser,
    metadata: RequestMetadata,
  ) {
    const portalUser = await this.auth.provisionVerifiedUserForBootstrap(
      {
        displayName: DEMO_PORTAL_USER.displayName,
        email: DEMO_PORTAL_USER.email,
        password: DEMO_PASSWORD,
      },
      metadata,
    );

    const existing = await this.prisma.contact.findFirst({
      where: { organizationId: context.id, displayName: DEMO_PORTAL_CUSTOMER },
      select: { id: true },
    });
    const contact =
      existing ??
      (await this.customers.create(
        context,
        owner,
        {
          displayName: DEMO_PORTAL_CUSTOMER,
          email: 'accounts@karibu-wholesale.example',
          phone: '+254712345678',
        },
        metadata,
      ));

    const invoiced = await this.prisma.invoice.count({
      where: { organizationId: context.id, contactId: contact.id },
    });
    if (invoiced === 0) {
      const draft = await this.invoices.createDraft(
        context,
        owner,
        {
          contactId: contact.id,
          lines: [
            { description: 'Shelf restock — assorted', quantity: '40', unitPriceMinor: '45000' },
            { description: 'Delivery and handling', quantity: '1', unitPriceMinor: '120000' },
          ],
        },
        metadata,
      );
      await this.invoices.issueInvoice(context, owner, draft.id, metadata);
    }

    const quoted = await this.prisma.quote.count({
      where: { organizationId: context.id, contactId: contact.id },
    });
    if (quoted === 0) {
      const quote = await this.quotes.createDraft(
        context,
        owner,
        {
          contactId: contact.id,
          lines: [{ description: 'Q3 supply agreement', quantity: '1', unitPriceMinor: '2400000' }],
        },
        metadata,
      );
      await this.quotes.submitForApproval(context, owner, quote.id, metadata);
      await this.quotes.approve(context, owner, quote.id, metadata);
      await this.quotes.send(context, owner, quote.id, metadata);
    }

    await this.prisma.portalUser.upsert({
      where: {
        organizationId_contactId_userId: {
          organizationId: context.id,
          contactId: contact.id,
          userId: portalUser.id,
        },
      },
      update: { status: 'ACTIVE', revokedAt: null },
      create: {
        organizationId: context.id,
        contactId: contact.id,
        userId: portalUser.id,
        invitedByUserId: owner.id,
      },
    });
  }

  private async verify(organizationId: string) {
    const [
      organization,
      systemAccounts,
      auditEvents,
      securityEvents,
      queue,
      portalGrants,
      issuedInvoices,
      sentQuotes,
    ] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: {
          roles: true,
          members: { include: { user: true, role: true } },
          enabledCurrencies: true,
          exchangeRates: true,
          fiscalYears: { include: { periods: true } },
          taxCodes: { include: { rates: true } },
          journals: {
            where: { sourceType: { in: [SOURCE_TYPE, 'REVERSAL'] } },
            include: { lines: { include: { account: true } }, reversalJournal: true },
          },
        },
      }),
      this.prisma.ledgerAccount.count({
        where: { organizationId, systemKey: { not: null } },
      }),
      this.prisma.auditEvent.count({ where: { organizationId } }),
      this.prisma.securityEvent.count({ where: { organizationId } }),
      this.emailQueue.counts(),
      this.prisma.portalUser.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.invoice.count({ where: { organizationId, status: { not: 'DRAFT' } } }),
      this.prisma.quote.count({ where: { organizationId, sentAt: { not: null } } }),
    ]);
    const portalDocuments = issuedInvoices + sentQuotes;
    const foreign = organization.journals.find((journal) => journal.sourceId === 'foreign-sale');
    const taxed = organization.journals.find((journal) => journal.sourceId === 'taxed-sale');
    const reversed = organization.journals.find(
      (journal) => journal.sourceId === 'reversible-expense',
    );

    assert(organization.status === OrganizationStatus.ACTIVE, 'Demo organization is not active.');
    assert(organization.roles.length === 8, 'Demo organization does not have eight system roles.');
    assert(
      organization.members.length === 5,
      'Demo organization does not have five active members.',
    );
    // Derived from the catalog rather than a literal: the key list has grown since Phase 1
    // (customer_credit and vendor_credit arrived with credit notes), and a hard-coded count turns
    // every future addition into a seed failure long after the change that caused it.
    assert(
      systemAccounts === SYSTEM_ACCOUNT_KEYS.length,
      `Not all ${SYSTEM_ACCOUNT_KEYS.length} system-account keys are bound.`,
    );
    assert(
      organization.fiscalYears[0]?.periods.length === 12,
      'The open fiscal year is incomplete.',
    );
    assert(
      organization.enabledCurrencies.filter((currency) => currency.enabled).length >= 3,
      'The demo organization does not have three enabled currencies.',
    );
    assert(organization.exchangeRates.length >= 2, 'Demo exchange rates are missing.');
    assert(organization.taxCodes.length >= 3, 'Demo tax codes are missing.');
    assert(
      taxed?.lines.some((line) => line.taxRatePercentSnapshot !== null),
      'The taxed journal has no frozen tax snapshot.',
    );
    assert(
      foreign?.exchangeRate !== null &&
        foreign?.lines.some((line) => line.foreignAmountMinor !== null) &&
        foreign.lines.some((line) => line.account.systemKey === 'fx_gain'),
      'The foreign journal is missing its rate, foreign amount, or FX gain line.',
    );
    assert(
      reversed?.status === 'REVERSED' && Boolean(reversed.reversalJournal),
      'The reversible demo journal was not reversed.',
    );
    assert(auditEvents > 0 && securityEvents > 0, 'Audit/security events were not created.');
    assert(portalGrants === 1, 'The demo portal grant is missing.');
    assert(portalDocuments >= 2, 'The demo portal customer has no visible documents.');

    return {
      organization: {
        id: organization.id,
        slug: organization.slug,
        name: organization.tradingName ?? organization.legalName,
        status: organization.status,
      },
      credentials: { password: DEMO_PASSWORD, users: DEMO_USERS },
      counts: {
        roles: organization.roles.length,
        members: organization.members.length,
        systemAccounts,
        fiscalPeriods: organization.fiscalYears[0]?.periods.length ?? 0,
        enabledCurrencies: organization.enabledCurrencies.filter((currency) => currency.enabled)
          .length,
        exchangeRates: organization.exchangeRates.length,
        taxCodes: organization.taxCodes.length,
        journals: organization.journals.length,
        auditEvents,
        securityEvents,
        portalGrants,
        portalDocuments,
      },
      proof: {
        taxSnapshot: true,
        reversal: true,
        foreignJournal: {
          id: foreign?.id,
          exchangeRate: foreign?.exchangeRate?.toString(),
          fxGainMinor: foreign?.lines
            .find((line) => line.account.systemKey === 'fx_gain')
            ?.creditMinor.toString(),
        },
        emailQueue: { ...queue, depth: queue.waiting + queue.active + queue.delayed },
      },
    };
  }
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
