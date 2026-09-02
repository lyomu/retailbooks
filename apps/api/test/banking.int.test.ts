import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { BankRulesService } from '../src/banking/bank-rules.service.js';
import { CurrencyService } from '../src/organizations/currency.service.js';
import { BankTransactionsService } from '../src/banking/bank-transactions.service.js';
import { computeBankTransactionFingerprint } from '../src/banking/bank-transaction-fingerprint.js';
import { FinancialAccountsService } from '../src/banking/financial-accounts.service.js';
import { ReconciliationsService } from '../src/banking/reconciliations.service.js';
import { StatementImportsService } from '../src/banking/statement-imports.service.js';
import { TransfersService } from '../src/banking/transfers.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'banking-test',
  userAgent: 'RetailBooks integration test',
};

/**
 * The statement `amount` column is a signed decimal in MAJOR units, which the importer scales
 * by 100. Rows here are written in minor units to match the rest of the codebase's money
 * convention and converted on the way out, so an assertion in minor units lines up with what
 * was actually imported.
 */
function minorToDecimal(amountMinor: string): string {
  const negative = amountMinor.startsWith('-');
  const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Builds a statement CSV in the header shape `StatementImportsService.import` expects. */
function statementCsv(
  rows: readonly (readonly [
    date: string,
    description: string,
    reference: string,
    amountMinor: string,
  ])[],
): string {
  return [
    'date,description,reference,amount',
    ...rows.map(([date, description, reference, amountMinor]) =>
      [date, description, reference, minorToDecimal(amountMinor)].join(','),
    ),
  ].join('\n');
}

function upload(csv: string, filename = 'statement.csv') {
  return {
    originalname: filename,
    mimetype: 'text/csv',
    size: Buffer.byteLength(csv),
    buffer: Buffer.from(csv, 'utf8'),
  };
}

describe('banking and reconciliation against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let financialAccounts: FinancialAccountsService;
  let statementImports: StatementImportsService;
  let bankTransactions: BankTransactionsService;
  let bankRules: BankRulesService;
  let transfers: TransfersService;
  let reconciliations: ReconciliationsService;
  let currencies: CurrencyService;
  let customers: CustomersService;
  let payments: PaymentsService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let baseCurrency: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    financialAccounts = harness.app.get(FinancialAccountsService);
    statementImports = harness.app.get(StatementImportsService);
    bankTransactions = harness.app.get(BankTransactionsService);
    bankRules = harness.app.get(BankRulesService);
    transfers = harness.app.get(TransfersService);
    reconciliations = harness.app.get(ReconciliationsService);
    currencies = harness.app.get(CurrencyService);
    customers = harness.app.get(CustomersService);
    payments = harness.app.get(PaymentsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'banking-owner@example.test',
        displayName: 'Banking Owner',
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
      { legalName: 'Banking Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
    const organization = await harness.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { baseCurrency: true },
    });
    baseCurrency = organization.baseCurrency;
  });

  // --- 2A.1 duplicate-fingerprint detection -------------------------------------------------

  it('treats an identical re-import as duplicates and never creates a second transaction', async () => {
    const account = await createFinancialAccount('Main Current Account');
    const csv = statementCsv([
      ['2026-02-01', 'Card settlement', 'REF-1', '15000'],
      ['2026-02-02', 'Supplier payment', 'REF-2', '-4500'],
    ]);

    const first = await statementImports.import(context, owner, account.id, upload(csv), metadata);
    expect(first.importedCount).toBe(2);
    expect(first.duplicateCount).toBe(0);
    expect(await transactionCount()).toBe(2);

    const second = await statementImports.import(context, owner, account.id, upload(csv), metadata);
    expect(second.importedCount).toBe(0);
    expect(second.duplicateCount).toBe(2);
    expect(await transactionCount()).toBe(2);
  });

  it('does not treat a same-date, same-amount row with a different description as a duplicate', async () => {
    const account = await createFinancialAccount('Main Current Account');
    await statementImports.import(
      context,
      owner,
      account.id,
      upload(statementCsv([['2026-02-01', 'Card settlement', '', '15000']])),
      metadata,
    );

    const nearMiss = await statementImports.import(
      context,
      owner,
      account.id,
      upload(statementCsv([['2026-02-01', 'Card settlement batch two', '', '15000']])),
      metadata,
    );

    expect(nearMiss.importedCount).toBe(1);
    expect(nearMiss.duplicateCount).toBe(0);
    expect(await transactionCount()).toBe(2);
  });

  it('derives the same fingerprint for identical input and a different one for any changed field', () => {
    const base = {
      financialAccountId: '11111111-1111-4111-8111-111111111111',
      transactionDate: '2026-02-01',
      direction: 'INFLOW' as const,
      amountMinor: 15000n,
      description: 'Card settlement',
      reference: 'REF-1',
    };
    expect(computeBankTransactionFingerprint(base)).toBe(
      computeBankTransactionFingerprint({ ...base }),
    );
    expect(computeBankTransactionFingerprint({ ...base, amountMinor: 15001n })).not.toBe(
      computeBankTransactionFingerprint(base),
    );
    expect(computeBankTransactionFingerprint({ ...base, reference: null })).not.toBe(
      computeBankTransactionFingerprint(base),
    );
  });

  it('records unparseable rows as failed without aborting the whole import', async () => {
    const account = await createFinancialAccount('Main Current Account');
    const result = await statementImports.import(
      context,
      owner,
      account.id,
      upload(
        statementCsv([
          ['2026-02-01', 'Good row', '', '15000'],
          ['not-a-date', 'Bad row', '', 'not-a-number'],
        ]),
      ),
      metadata,
    );

    expect(result.importedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    const failed = await statementImports.failedRows(context.id, result.id);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.outcome).toBe('FAILED');
  });

  // --- 2A.2 a match can never double-allocate a source document ------------------------------

  it('refuses to match one payment to two bank transactions, and releases it on unmatch', async () => {
    const account = await createFinancialAccount('Main Current Account');
    await statementImports.import(
      context,
      owner,
      account.id,
      upload(
        statementCsv([
          ['2026-02-01', 'Customer settlement A', 'A', '2500'],
          ['2026-02-02', 'Customer settlement B', 'B', '2500'],
        ]),
      ),
      metadata,
    );
    const [first, second] = await inflowTransactions();
    if (!first || !second) throw new Error('expected two inflow transactions');
    const payment = await recordCustomerPayment('2500');

    const matched = await bankTransactions.match(
      context,
      owner,
      first.id,
      { targetType: 'PAYMENT_RECEIVED', targetId: payment.id },
      metadata,
    );
    expect(matched.disposition).toBe('MATCHED');

    await expect(
      bankTransactions.match(
        context,
        owner,
        second.id,
        { targetType: 'PAYMENT_RECEIVED', targetId: payment.id },
        metadata,
      ),
    ).rejects.toThrow(/already matched/i);
    expect(await harness.prisma.match.count({ where: { organizationId: context.id } })).toBe(1);

    await bankTransactions.unmatch(context, owner, first.id, metadata);
    expect(await harness.prisma.match.count({ where: { organizationId: context.id } })).toBe(0);

    const rematched = await bankTransactions.match(
      context,
      owner,
      second.id,
      { targetType: 'PAYMENT_RECEIVED', targetId: payment.id },
      metadata,
    );
    expect(rematched.disposition).toBe('MATCHED');
  });

  it('rejects a match whose direction or amount disagrees with the transaction', async () => {
    const account = await createFinancialAccount('Main Current Account');
    await statementImports.import(
      context,
      owner,
      account.id,
      upload(
        statementCsv([
          ['2026-02-01', 'Customer settlement', 'A', '2500'],
          ['2026-02-02', 'Outgoing settlement', 'B', '-2500'],
        ]),
      ),
      metadata,
    );
    const [inflow] = await inflowTransactions();
    if (!inflow) throw new Error('expected an inflow transaction');
    const outflow = await harness.prisma.bankTransaction.findFirstOrThrow({
      where: { organizationId: context.id, direction: 'OUTFLOW' },
    });
    const payment = await recordCustomerPayment('2500');
    const mismatchedPayment = await recordCustomerPayment('9900');

    await expect(
      bankTransactions.match(
        context,
        owner,
        outflow.id,
        { targetType: 'PAYMENT_RECEIVED', targetId: payment.id },
        metadata,
      ),
    ).rejects.toThrow(/inflow/i);

    await expect(
      bankTransactions.match(
        context,
        owner,
        inflow.id,
        { targetType: 'PAYMENT_RECEIVED', targetId: mismatchedPayment.id },
        metadata,
      ),
    ).rejects.toThrow(/amount/i);
  });

  // --- 2A.3 categorize / split / exclude posting ---------------------------------------------

  it('posts a balanced journal when a transaction is categorized to one account', async () => {
    const account = await createFinancialAccount('Main Current Account');
    await statementImports.import(
      context,
      owner,
      account.id,
      upload(statementCsv([['2026-02-01', 'Office rent', '', '-4500']])),
      metadata,
    );
    const transaction = await harness.prisma.bankTransaction.findFirstOrThrow({
      where: { organizationId: context.id },
    });
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');

    const posted = await bankTransactions.categorize(
      context,
      owner,
      transaction.id,
      { lines: [{ accountId: expenseAccount.id, amountMinor: '4500' }] },
      metadata,
    );

    expect(posted.disposition).toBe('POSTED');
    const journalId = (
      await harness.prisma.bankTransaction.findUniqueOrThrow({ where: { id: transaction.id } })
    ).postedJournalId;
    expect(journalId).not.toBeNull();
    await expectBalancedJournal(journalId!);
  });

  it('posts a split across several accounts as one balanced journal and rejects an unbalanced split', async () => {
    const account = await createFinancialAccount('Main Current Account');
    await statementImports.import(
      context,
      owner,
      account.id,
      upload(
        statementCsv([
          ['2026-02-01', 'Mixed spend', 'A', '-4500'],
          ['2026-02-02', 'Second mixed spend', 'B', '-4500'],
        ]),
      ),
      metadata,
    );
    const [first, second] = await harness.prisma.bankTransaction.findMany({
      where: { organizationId: context.id },
      orderBy: { transactionDate: 'asc' },
    });
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const cogsAccount = await ledger.accountBySystemKey(context.id, 'cogs');

    await expect(
      bankTransactions.categorize(
        context,
        owner,
        first!.id,
        {
          lines: [
            { accountId: expenseAccount.id, amountMinor: '2000' },
            { accountId: cogsAccount.id, amountMinor: '2000' },
          ],
        },
        metadata,
      ),
    ).rejects.toThrow(/must equal/i);

    const posted = await bankTransactions.categorize(
      context,
      owner,
      second!.id,
      {
        lines: [
          { accountId: expenseAccount.id, amountMinor: '3000' },
          { accountId: cogsAccount.id, amountMinor: '1500' },
        ],
      },
      metadata,
    );
    expect(posted.disposition).toBe('POSTED');

    const journal = await harness.prisma.bankTransaction.findUniqueOrThrow({
      where: { id: second!.id },
    });
    const lines = await expectBalancedJournal(journal.postedJournalId!);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('excludes a transaction with a reason and posts nothing to the ledger', async () => {
    const account = await createFinancialAccount('Main Current Account');
    await statementImports.import(
      context,
      owner,
      account.id,
      upload(statementCsv([['2026-02-01', 'Personal spend', '', '-500']])),
      metadata,
    );
    const transaction = await harness.prisma.bankTransaction.findFirstOrThrow({
      where: { organizationId: context.id },
    });
    const journalsBefore = await harness.prisma.journal.count({
      where: { organizationId: context.id },
    });

    const excluded = await bankTransactions.exclude(
      context,
      owner,
      transaction.id,
      'Owner personal spend',
      metadata,
    );

    expect(excluded.disposition).toBe('EXCLUDED');
    expect(await harness.prisma.journal.count({ where: { organizationId: context.id } })).toBe(
      journalsBefore,
    );
  });

  // --- 2A.4 transfers -------------------------------------------------------------------------

  it('posts a same-currency transfer as one balanced journal touching both account mappings', async () => {
    const from = await createFinancialAccount('Main Current Account');
    const to = await createFinancialAccount('Savings Account', 'savings');

    const transfer = await transfers.create(
      context,
      owner,
      {
        fromFinancialAccountId: from.id,
        toFinancialAccountId: to.id,
        transferDate: '2026-02-05',
        fromAmountMinor: '25000',
        toAmountMinor: '25000',
      },
      metadata,
    );

    expect(transfer.status).toBe('POSTED');
    const record = await harness.prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
    const lines = await expectBalancedJournal(record.journalId!);
    const accountIds = lines.map((line) => line.accountId);
    expect(accountIds).toContain(from.glAccountId);
    expect(accountIds).toContain(to.glAccountId);
  });

  it('rejects a same-currency transfer whose legs disagree and a transfer to the same account', async () => {
    const from = await createFinancialAccount('Main Current Account');
    const to = await createFinancialAccount('Savings Account', 'savings');

    await expect(
      transfers.create(
        context,
        owner,
        {
          fromFinancialAccountId: from.id,
          toFinancialAccountId: to.id,
          transferDate: '2026-02-05',
          fromAmountMinor: '25000',
          toAmountMinor: '24000',
        },
        metadata,
      ),
    ).rejects.toThrow(/equal amounts/i);

    await expect(
      transfers.create(
        context,
        owner,
        {
          fromFinancialAccountId: from.id,
          toFinancialAccountId: from.id,
          transferDate: '2026-02-05',
          fromAmountMinor: '25000',
          toAmountMinor: '25000',
        },
        metadata,
      ),
    ).rejects.toThrow(/different accounts/i);
  });

  it('posts a cross-currency transfer as a balanced base-currency journal with an FX line', async () => {
    await currencies.enable(context, owner, { currencyCode: 'USD' }, metadata);
    await currencies.upsertRate(
      context,
      owner,
      { quoteCurrency: 'USD', rate: '129.5', rateDate: '2026-02-05' },
      metadata,
    );
    const from = await createFinancialAccount('Main Current Account');
    const to = await createFinancialAccount('USD Account', 'usd-bank', 'USD');

    // 25 000 KES out, 190 USD in. At 129.5 KES/USD the USD leg is worth 24 605 KES, so the
    // 395 minor-unit shortfall has to land on an FX account for the journal to balance.
    const transfer = await transfers.create(
      context,
      owner,
      {
        fromFinancialAccountId: from.id,
        toFinancialAccountId: to.id,
        transferDate: '2026-02-05',
        fromAmountMinor: '25000',
        toAmountMinor: '19000',
      },
      metadata,
    );

    const record = await harness.prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
    const lines = await expectBalancedJournal(record.journalId!);
    const fxGain = await ledger.accountBySystemKey(context.id, 'fx_gain');
    const fxLoss = await ledger.accountBySystemKey(context.id, 'fx_loss');
    const fxLines = lines.filter(
      (line) => line.accountId === fxGain.id || line.accountId === fxLoss.id,
    );
    expect(fxLines.length).toBeGreaterThan(0);
  });

  it('voids a posted transfer by reversal, leaving the original journal untouched', async () => {
    const from = await createFinancialAccount('Main Current Account');
    const to = await createFinancialAccount('Savings Account', 'savings');
    const transfer = await transfers.create(
      context,
      owner,
      {
        fromFinancialAccountId: from.id,
        toFinancialAccountId: to.id,
        transferDate: '2026-02-05',
        fromAmountMinor: '25000',
        toAmountMinor: '25000',
      },
      metadata,
    );
    const original = await harness.prisma.transfer.findUniqueOrThrow({
      where: { id: transfer.id },
    });
    const originalLines = await harness.prisma.journalLine.findMany({
      where: { journalId: original.journalId! },
      orderBy: { lineNumber: 'asc' },
    });

    const voided = await transfers.void(context, owner, transfer.id, metadata);
    expect(voided.status).toBe('VOID');

    // The original posting is immutable; the reversal is a separate journal.
    const linesAfter = await harness.prisma.journalLine.findMany({
      where: { journalId: original.journalId! },
      orderBy: { lineNumber: 'asc' },
    });
    expect(linesAfter).toEqual(originalLines);
    expect(
      await harness.prisma.journal.count({ where: { organizationId: context.id } }),
    ).toBeGreaterThan(1);

    // Net effect across both accounts' GL mappings is zero once reversed.
    for (const glAccountId of [from.glAccountId, to.glAccountId]) {
      expect(await postedAccountMovement(glAccountId)).toBe(0n);
    }
  });

  // --- 2A.5 reconciliation completes only at zero difference and locks ------------------------

  it('completes only at a zero difference, locks on completion, and reopens with a reason', async () => {
    const account = await createFinancialAccount('Main Current Account');
    await statementImports.import(
      context,
      owner,
      account.id,
      upload(
        statementCsv([
          ['2026-02-01', 'Customer settlement', 'A', '2500'],
          ['2026-02-02', 'Supplier payment', 'B', '-500'],
        ]),
      ),
      metadata,
    );
    const transactions = await harness.prisma.bankTransaction.findMany({
      where: { organizationId: context.id },
      orderBy: { transactionDate: 'asc' },
    });

    // Opening 0 + 2500 inflow - 500 outflow = 2000 closing.
    const reconciliation = await reconciliations.start(
      context,
      owner,
      {
        financialAccountId: account.id,
        statementStartDate: '2026-02-01',
        statementEndDate: '2026-02-28',
        openingBalanceMinor: '0',
        closingBalanceMinor: '2000',
      },
      metadata,
    );

    // Nothing cleared yet: difference is 2000, so completion must be refused.
    await expect(
      reconciliations.complete(context, owner, reconciliation.id, metadata),
    ).rejects.toThrow(/does not balance/i);

    // Clearing only the inflow leaves a 500 difference — still refused.
    await reconciliations.setCleared(
      context,
      owner,
      reconciliation.id,
      { transactionIds: [transactions[0]!.id] },
      metadata,
      true,
    );
    await expect(
      reconciliations.complete(context, owner, reconciliation.id, metadata),
    ).rejects.toThrow(/does not balance/i);

    await reconciliations.setCleared(
      context,
      owner,
      reconciliation.id,
      { transactionIds: [transactions[1]!.id] },
      metadata,
      true,
    );
    const completed = await reconciliations.complete(context, owner, reconciliation.id, metadata);
    expect(completed.status).toBe('COMPLETED');

    // Locked: a completed reconciliation accepts neither clear nor unclear nor a second complete.
    await expect(
      reconciliations.setCleared(
        context,
        owner,
        reconciliation.id,
        { transactionIds: [transactions[0]!.id] },
        metadata,
        false,
      ),
    ).rejects.toThrow(/in-progress/i);
    await expect(
      reconciliations.complete(context, owner, reconciliation.id, metadata),
    ).rejects.toThrow(/in-progress/i);

    const reopened = await reconciliations.reopen(
      context,
      owner,
      reconciliation.id,
      'Bank reissued the statement',
      metadata,
    );
    expect(reopened.status).toBe('IN_PROGRESS');
    const stored = await harness.prisma.reconciliation.findUniqueOrThrow({
      where: { id: reconciliation.id },
    });
    expect(stored.reopenReason).toBe('Bank reissued the statement');
    expect(
      await harness.prisma.auditEvent.count({
        where: { organizationId: context.id, eventKey: 'banking.reconciliation_reopened' },
      }),
    ).toBe(1);
  });

  it('refuses to clear a transaction that belongs to a different financial account', async () => {
    const account = await createFinancialAccount('Main Current Account');
    const other = await createFinancialAccount('Savings Account', 'savings');
    await statementImports.import(
      context,
      owner,
      other.id,
      upload(statementCsv([['2026-02-01', 'Other account inflow', '', '1000']])),
      metadata,
    );
    const foreign = await harness.prisma.bankTransaction.findFirstOrThrow({
      where: { organizationId: context.id, financialAccountId: other.id },
    });

    const reconciliation = await reconciliations.start(
      context,
      owner,
      {
        financialAccountId: account.id,
        statementStartDate: '2026-02-01',
        statementEndDate: '2026-02-28',
        openingBalanceMinor: '0',
        closingBalanceMinor: '0',
      },
      metadata,
    );

    await expect(
      reconciliations.setCleared(
        context,
        owner,
        reconciliation.id,
        { transactionIds: [foreign.id] },
        metadata,
        true,
      ),
    ).rejects.toThrow(/not found/i);
  });

  // --- bank rules feed suggestions without posting anything -----------------------------------

  it('attaches a bank-rule suggestion on import without changing the transaction disposition', async () => {
    const account = await createFinancialAccount('Main Current Account');
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    await bankRules.create(
      context,
      owner,
      {
        name: 'Rent to general expense',
        priority: 1,
        conditions: [{ field: 'description', operator: 'contains', value: 'rent' }],
        suggestAccountId: expenseAccount.id,
      },
      metadata,
    );

    await statementImports.import(
      context,
      owner,
      account.id,
      upload(statementCsv([['2026-02-01', 'Monthly office rent', '', '-4500']])),
      metadata,
    );

    const transaction = await harness.prisma.bankTransaction.findFirstOrThrow({
      where: { organizationId: context.id },
    });
    expect(transaction.disposition).toBe('UNRESOLVED');
    expect(transaction.suggestedAccountId).toBe(expenseAccount.id);
  });

  // --- helpers ---------------------------------------------------------------------------------

  async function createFinancialAccount(name: string, glCode?: string, currency?: string) {
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
      { name, type: 'BANK', currency: currency ?? baseCurrency, glAccountId: glAccount.id },
      metadata,
    );
  }

  async function recordCustomerPayment(amountMinor: string) {
    const customer = await customers.create(
      context,
      owner,
      { displayName: `Customer ${amountMinor}-${Math.random().toString(36).slice(2, 8)}` },
      metadata,
    );
    return payments.record(
      context,
      owner,
      { contactId: customer.id, receivedDate: '2026-02-03', amountMinor },
      metadata,
    );
  }

  function transactionCount() {
    return harness.prisma.bankTransaction.count({ where: { organizationId: context.id } });
  }

  function inflowTransactions() {
    return harness.prisma.bankTransaction.findMany({
      where: { organizationId: context.id, direction: 'INFLOW' },
      orderBy: { transactionDate: 'asc' },
    });
  }

  /** Asserts the journal exists, is posted, and balances; returns its lines. */
  async function expectBalancedJournal(journalId: string) {
    const journal = await harness.prisma.journal.findUniqueOrThrow({ where: { id: journalId } });
    expect(journal.status).toBe('POSTED');
    const lines = await harness.prisma.journalLine.findMany({
      where: { journalId },
      orderBy: { lineNumber: 'asc' },
    });
    const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debit).toBe(credit);
    expect(debit).toBeGreaterThan(0n);
    return lines;
  }

  /** Net debit-minus-credit movement on an account across every posted journal. */
  async function postedAccountMovement(accountId: string) {
    const lines = await harness.prisma.journalLine.findMany({
      where: {
        organizationId: context.id,
        accountId,
        // The ledger counts POSTED and REVERSED alike; a reversal does not un-post its original.
        journal: { status: { in: ['POSTED', 'REVERSED'] } },
      },
    });
    return lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n);
  }
});
