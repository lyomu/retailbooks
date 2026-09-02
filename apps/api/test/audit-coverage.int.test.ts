import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { BankTransactionsService } from '../src/banking/bank-transactions.service.js';
import { FinancialAccountsService } from '../src/banking/financial-accounts.service.js';
import { StatementImportsService } from '../src/banking/statement-imports.service.js';
import { TransfersService } from '../src/banking/transfers.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { PaymentsMadeService } from '../src/purchases/payments-made.service.js';
import { VendorCreditsService } from '../src/purchases/vendor-credits.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { CatalogService } from '../src/sales/catalog.service.js';
import { CreditNotesService } from '../src/sales/credit-notes.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'audit-coverage-test',
  userAgent: 'RetailBooks integration test',
};

/**
 * Stage 4.2 — audit-log coverage and the immutable-posting invariant.
 *
 * These assertions are deliberately structural rather than a hand-maintained list of actions.
 * The boundary-matrix work at Stage 2B taught the lesson: a checklist compared against another
 * checklist cannot detect what is missing from both, which is how forty-three endpoints shipped
 * uncovered. So instead of enumerating "these are the money-moving actions", this suite drives a
 * broad scenario and then asserts two properties of *every* journal it finds posted:
 *
 *   A. Every posted journal has a `ledger.journal_posted` audit row naming it. This holds by
 *      construction today because `LedgerService.finalizePosting` is the single chokepoint every
 *      posting path funnels through, and it writes the row inside the posting transaction. The
 *      test exists so that a future path which bypasses that chokepoint fails here.
 *
 *   B. Every posted journal that names a source document — `sourceType`/`sourceId`, which
 *      `postJournalFromLines` requires — also has an audit row for that document. A manual journal
 *      has no source and is covered by A alone. This is the property that bites when a Phase 7
 *      module posts a journal and forgets to audit the business action that caused it.
 *
 * A new posting path therefore has to opt *out* of coverage to go unnoticed, rather than opt in.
 */
describe('audit coverage and posted-journal immutability', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let catalog: CatalogService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let payments: PaymentsService;
  let creditNotes: CreditNotesService;
  let vendors: VendorsService;
  let bills: BillsService;
  let expenses: ExpensesService;
  let paymentsMade: PaymentsMadeService;
  let vendorCredits: VendorCreditsService;
  let financialAccounts: FinancialAccountsService;
  let statementImports: StatementImportsService;
  let bankTransactions: BankTransactionsService;
  let transfers: TransfersService;
  let inventory: InventoryService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let baseCurrency: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    catalog = harness.app.get(CatalogService);
    customers = harness.app.get(CustomersService);
    invoices = harness.app.get(InvoicesService);
    payments = harness.app.get(PaymentsService);
    creditNotes = harness.app.get(CreditNotesService);
    vendors = harness.app.get(VendorsService);
    bills = harness.app.get(BillsService);
    expenses = harness.app.get(ExpensesService);
    paymentsMade = harness.app.get(PaymentsMadeService);
    vendorCredits = harness.app.get(VendorCreditsService);
    financialAccounts = harness.app.get(FinancialAccountsService);
    statementImports = harness.app.get(StatementImportsService);
    bankTransactions = harness.app.get(BankTransactionsService);
    transfers = harness.app.get(TransfersService);
    inventory = harness.app.get(InventoryService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'audit-owner@example.test',
        displayName: 'Audit Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    owner = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const created = await organizations.create(
      owner,
      { legalName: 'Audit Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
    baseCurrency = (
      await harness.prisma.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      })
    ).baseCurrency;
  });

  it('audits every journal the sales and purchases document paths post', async () => {
    const customer = await customers.create(
      context,
      owner,
      { displayName: 'Audit Customer' },
      metadata,
    );
    const vendor = await vendors.create(context, owner, { displayName: 'Audit Vendor' }, metadata);

    const invoice = await issueInvoice(customer.id, '5000');
    const receipt = await payments.record(
      context,
      owner,
      { contactId: customer.id, receivedDate: '2026-02-03', amountMinor: '3000' },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      receipt.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '3000' }] },
      metadata,
    );
    const creditNoteDraft = await creditNotes.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [{ description: 'Returned goods', quantity: '1', unitPriceMinor: '500' }],
      },
      metadata,
    );
    await creditNotes.issueCreditNote(context, owner, creditNoteDraft.id, metadata);

    const bill = await issueBill(vendor.id, '4000');
    const vendorPayment = await paymentsMade.record(
      context,
      owner,
      { vendorId: vendor.id, paidDate: '2026-02-04', amountMinor: '2000' },
      metadata,
    );
    await paymentsMade.allocate(
      context,
      owner,
      vendorPayment.id,
      { allocations: [{ billId: bill.id, amountMinor: '2000' }] },
      metadata,
    );
    const vendorCreditDraft = await vendorCredits.createDraft(
      context,
      owner,
      {
        vendorId: vendor.id,
        lines: [{ description: 'Vendor rebate', quantity: '1', unitPriceMinor: '600' }],
      },
      metadata,
    );
    await vendorCredits.issueVendorCredit(context, owner, vendorCreditDraft.id, metadata);

    const paidThrough = await ledger.accountBySystemKey(context.id, 'bank_default');
    const expenseDraft = await expenses.createDraft(
      context,
      owner,
      {
        payeeVendorId: vendor.id,
        expenseDate: '2026-02-05',
        paidThroughAccountId: paidThrough.id,
        amountMinor: '900',
      },
      metadata,
    );
    await expenses.post(context, owner, expenseDraft.id, metadata);

    await expectSourceTypesPosted([
      'SALES_INVOICE',
      'PAYMENT_RECEIVED',
      'CREDIT_NOTE',
      'BILL',
      'PAYMENT_MADE',
      'VENDOR_CREDIT',
      'EXPENSE',
    ]);
    await expectEveryPostedJournalAudited();
  });

  it('audits every journal the banking and inventory paths post', async () => {
    const account = await createFinancialAccount('Main Current Account');
    const second = await createFinancialAccount('Savings Account', '10250');
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');

    await statementImports.import(
      context,
      owner,
      account.id,
      statementUpload([['2026-02-01', 'Office supplies', 'REF-1', '-4500']]),
      metadata,
    );
    const transaction = await harness.prisma.bankTransaction.findFirstOrThrow({
      where: { organizationId: context.id },
    });
    await bankTransactions.categorize(
      context,
      owner,
      transaction.id,
      { lines: [{ accountId: expenseAccount.id, amountMinor: '4500' }] },
      metadata,
    );

    await transfers.create(
      context,
      owner,
      {
        fromFinancialAccountId: account.id,
        toFinancialAccountId: second.id,
        transferDate: '2026-02-06',
        fromAmountMinor: '10000',
        toAmountMinor: '10000',
      },
      metadata,
    );

    const item = await catalog.createItem(
      context,
      owner,
      { sku: 'AUD-001', name: 'Audited widget', itemType: 'GOODS', inventoryTracked: true },
      metadata,
    );
    const warehouse = await inventory.createWarehouse(
      context,
      owner,
      { code: 'MAIN', name: 'Main' },
      metadata,
    );
    const adjustment = await inventory.createAdjustment(
      context,
      owner,
      {
        itemId: item.id,
        warehouseId: warehouse.id,
        adjustmentDate: '2026-02-01',
        quantityDelta: '10',
        valueDeltaMinor: '10000',
        reason: 'Opening count',
      },
      metadata,
    );
    await inventory.postAdjustment(context, owner, adjustment.id, metadata);

    await expectSourceTypesPosted(['BANK_TRANSACTION', 'TRANSFER', 'INVENTORY_ADJUSTMENT']);
    await expectEveryPostedJournalAudited();
  });

  it('audits the COGS journal an inventory-tracked invoice posts alongside the revenue journal', async () => {
    // COGS is posted by InventoryService from inside InvoicesService's transaction, so it is the
    // one path where a single business action posts two journals from two different modules.
    const item = await catalog.createItem(
      context,
      owner,
      { sku: 'COGS-001', name: 'Tracked widget', itemType: 'GOODS', inventoryTracked: true },
      metadata,
    );
    const warehouse = await inventory.createWarehouse(
      context,
      owner,
      { code: 'MAIN', name: 'Main' },
      metadata,
    );
    const adjustment = await inventory.createAdjustment(
      context,
      owner,
      {
        itemId: item.id,
        warehouseId: warehouse.id,
        adjustmentDate: '2026-02-01',
        quantityDelta: '5',
        valueDeltaMinor: '5000',
        reason: 'Opening count',
      },
      metadata,
    );
    await inventory.postAdjustment(context, owner, adjustment.id, metadata);

    const customer = await customers.create(
      context,
      owner,
      { displayName: 'COGS Customer' },
      metadata,
    );
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [
          { itemId: item.id, warehouseId: warehouse.id, quantity: '2', unitPriceMinor: '5000' },
        ],
      },
      metadata,
    );
    await invoices.issueInvoice(context, owner, draft.id, metadata);

    await expectSourceTypesPosted(['SALES_INVOICE', 'INVENTORY_COGS']);
    await expectEveryPostedJournalAudited();
  });

  it('audits a manual journal through the ledger event alone, since it has no source document', async () => {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const revenue = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const draft = await ledger.createJournalDraft(context, owner, {
      journalDate: '2026-02-10',
      currency: baseCurrency,
      description: 'Manual entry',
      lines: [
        { accountId: bank.id, debitMinor: '1000', creditMinor: '0' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '1000' },
      ],
    });
    const posted = await ledger.postJournal(context, owner, draft.id, metadata, 'manual-audit');

    const journal = await harness.prisma.journal.findUniqueOrThrow({ where: { id: posted.id } });
    expect(journal.sourceType).toBeNull();
    await expectEveryPostedJournalAudited();
  });

  // --- immutable posting ------------------------------------------------------------------------

  it('reverses a transfer by posting a new journal and leaves the original byte-for-byte intact', async () => {
    const from = await createFinancialAccount('Main Current Account');
    const to = await createFinancialAccount('Savings Account', '10250');
    const transfer = await transfers.create(
      context,
      owner,
      {
        fromFinancialAccountId: from.id,
        toFinancialAccountId: to.id,
        transferDate: '2026-02-06',
        fromAmountMinor: '25000',
        toAmountMinor: '25000',
      },
      metadata,
    );
    const original = await harness.prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
    });
    const before = await journalSnapshot(original.journalId);

    await transfers.void(context, owner, transfer.id, metadata);

    const after = await journalSnapshot(original.journalId);
    // Only the status may move, and only to REVERSED. Money, reference, date and lines are frozen.
    expect(after.lines).toEqual(before.lines);
    expect(after.reference).toBe(before.reference);
    expect(after.journalDate).toEqual(before.journalDate);
    expect(after.postedAt).toEqual(before.postedAt);
    expect(before.status).toBe('POSTED');
    expect(after.status).toBe('REVERSED');

    // The correction is a new journal, not an edit of the old one.
    const reversal = await harness.prisma.journal.findFirstOrThrow({
      where: { organizationId: context.id, reversalOfJournalId: original.journalId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    expect(reversal.id).not.toBe(original.journalId);
    expect(
      reversal.lines.map((line) => [line.accountId, line.debitMinor, line.creditMinor]),
    ).toEqual(before.lines.map((line) => [line.accountId, line.creditMinor, line.debitMinor]));

    await expectEveryPostedJournalAudited();
  });

  it('refuses to edit or delete a posted journal through the draft endpoints', async () => {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const revenue = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const input = {
      journalDate: '2026-02-10',
      currency: baseCurrency,
      description: 'Immutable entry',
      lines: [
        { accountId: bank.id, debitMinor: '1000', creditMinor: '0' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '1000' },
      ],
    };
    const draft = await ledger.createJournalDraft(context, owner, input);
    const posted = await ledger.postJournal(context, owner, draft.id, metadata, 'immutable-audit');
    const before = await journalSnapshot(posted.id);

    await expect(ledger.updateJournalDraft(context, posted.id, input)).rejects.toThrow(
      'Posted journals cannot be edited.',
    );
    await expect(ledger.deleteJournalDraft(context.id, posted.id)).rejects.toThrow(
      'Posted journals cannot be deleted.',
    );

    expect(await journalSnapshot(posted.id)).toEqual(before);
  });

  // --- shared invariants -------------------------------------------------------------------------

  /**
   * Invariants A and B from this file's header, over every posted journal in the organization.
   *
   * Failures name the journal's `sourceType`, because that is what identifies the code path with
   * the missing audit event.
   */
  async function expectEveryPostedJournalAudited() {
    const journals = await harness.prisma.journal.findMany({
      where: { organizationId: context.id, status: { in: ['POSTED', 'REVERSED'] } },
      select: { id: true, reference: true, sourceType: true, sourceId: true },
    });
    expect(journals.length).toBeGreaterThan(0);

    const events = await harness.prisma.auditEvent.findMany({
      where: { organizationId: context.id },
      select: { eventKey: true, entityType: true, entityId: true },
    });
    const journalEvents = new Set(
      events.filter((event) => event.entityType === 'journal').map((event) => event.entityId),
    );
    const auditedEntityIds = new Set(events.map((event) => event.entityId));

    const missingLedgerEvent: string[] = [];
    const missingSourceEvent: string[] = [];
    for (const journal of journals) {
      if (!journalEvents.has(journal.id)) {
        missingLedgerEvent.push(`${journal.reference} (${journal.sourceType ?? 'manual'})`);
      }
      if (journal.sourceId && !auditedEntityIds.has(journal.sourceId)) {
        missingSourceEvent.push(`${journal.reference} (${journal.sourceType})`);
      }
    }

    expect(missingLedgerEvent).toEqual([]);
    expect(missingSourceEvent).toEqual([]);
  }

  /**
   * Guards against a vacuous pass. If a scenario stops posting what it thinks it posts — a service
   * signature changes, a path silently no-ops — the coverage assertion above would still pass over
   * whatever journals remained. This fails instead, and names what went missing.
   */
  async function expectSourceTypesPosted(expected: readonly string[]) {
    const posted = await harness.prisma.journal.findMany({
      where: { organizationId: context.id, status: { in: ['POSTED', 'REVERSED'] } },
      select: { sourceType: true },
    });
    const actual = new Set(posted.map((journal) => journal.sourceType));
    expect(expected.filter((sourceType) => !actual.has(sourceType))).toEqual([]);
  }

  async function journalSnapshot(journalId: string) {
    const journal = await harness.prisma.journal.findUniqueOrThrow({
      where: { id: journalId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    return {
      status: journal.status,
      reference: journal.reference,
      journalDate: journal.journalDate,
      postedAt: journal.postedAt,
      currency: journal.currency,
      lines: journal.lines.map((line) => ({
        accountId: line.accountId,
        lineNumber: line.lineNumber,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        taxAmountMinor: line.taxAmountMinor,
      })),
    };
  }

  // --- scenario helpers --------------------------------------------------------------------------

  async function issueInvoice(customerId: string, amountMinor: string) {
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customerId,
        lines: [{ description: 'Consulting', quantity: '1', unitPriceMinor: amountMinor }],
      },
      metadata,
    );
    return invoices.issueInvoice(context, owner, draft.id, metadata);
  }

  async function issueBill(vendorId: string, amountMinor: string) {
    const draft = await bills.createDraft(
      context,
      owner,
      {
        vendorId,
        lines: [{ description: 'Subcontract', quantity: '1', unitPriceMinor: amountMinor }],
      },
      metadata,
    );
    return bills.issueBill(context, owner, draft.id, metadata);
  }

  async function createFinancialAccount(name: string, glCode?: string) {
    const glAccount = glCode
      ? await harness.prisma.ledgerAccount.create({
          data: {
            organizationId: context.id,
            code: glCode,
            name,
            type: 'ASSET',
            normalBalance: 'DEBIT',
          },
        })
      : await ledger.accountBySystemKey(context.id, 'bank_default');

    return financialAccounts.create(
      context,
      owner,
      { name, type: 'BANK', currency: baseCurrency, glAccountId: glAccount.id },
      metadata,
    );
  }

  /** Mirrors `banking.int.test.ts`: the statement `amount` column is signed decimal MAJOR units. */
  function statementUpload(
    rows: readonly (readonly [
      date: string,
      description: string,
      reference: string,
      amountMinor: string,
    ])[],
  ) {
    const csv = [
      'date,description,reference,amount',
      ...rows.map(([date, description, reference, amountMinor]) => {
        const negative = amountMinor.startsWith('-');
        const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(3, '0');
        const major = `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
        return [date, description, reference, major].join(',');
      }),
    ].join('\n');

    return {
      originalname: 'statement.csv',
      mimetype: 'text/csv',
      size: Buffer.byteLength(csv),
      buffer: Buffer.from(csv, 'utf8'),
    };
  }
});
