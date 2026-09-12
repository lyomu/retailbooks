import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { ApprovalTargetsService } from '../src/automation/approval-targets.service.js';
import { ApprovalsService } from '../src/automation/approvals.service.js';
import { BankTransactionsService } from '../src/banking/bank-transactions.service.js';
import { FinancialAccountsService } from '../src/banking/financial-accounts.service.js';
import { ReconciliationsService } from '../src/banking/reconciliations.service.js';
import { StatementImportsService } from '../src/banking/statement-imports.service.js';
import { CurrencyService } from '../src/organizations/currency.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { ReportingService } from '../src/reporting/reporting.service.js';
import { CreditNotesService } from '../src/sales/credit-notes.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { QuotesService } from '../src/sales/quotes.service.js';
import { StatementsService } from '../src/sales/statements.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'cross-module-scenarios-test',
  userAgent: 'RetailBooks integration test',
};

describe('cross-module acceptance scenarios against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let currencies: CurrencyService;
  let customers: CustomersService;
  let quotes: QuotesService;
  let invoices: InvoicesService;
  let payments: PaymentsService;
  let creditNotes: CreditNotesService;
  let statements: StatementsService;
  let financialAccounts: FinancialAccountsService;
  let statementImports: StatementImportsService;
  let bankTransactions: BankTransactionsService;
  let reconciliations: ReconciliationsService;
  let reports: ReportingService;
  let approvals: ApprovalsService;
  let approvalTargets: ApprovalTargetsService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let baseCurrency: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    currencies = harness.app.get(CurrencyService);
    customers = harness.app.get(CustomersService);
    quotes = harness.app.get(QuotesService);
    invoices = harness.app.get(InvoicesService);
    payments = harness.app.get(PaymentsService);
    creditNotes = harness.app.get(CreditNotesService);
    statements = harness.app.get(StatementsService);
    financialAccounts = harness.app.get(FinancialAccountsService);
    statementImports = harness.app.get(StatementImportsService);
    bankTransactions = harness.app.get(BankTransactionsService);
    reconciliations = harness.app.get(ReconciliationsService);
    reports = harness.app.get(ReportingService);
    approvals = harness.app.get(ApprovalsService);
    approvalTargets = harness.app.get(ApprovalTargetsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'cross-module-owner@example.test',
        displayName: 'Cross Module Owner',
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
      {
        legalName: 'Service Scenario Books Ltd',
        businessType: 'LIMITED_COMPANY',
        countryCode: 'KE',
      },
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

  it('proves service quote acceptance through payment, bank match, reconciliation, and reports', async () => {
    const customer = await customers.create(
      context,
      owner,
      { displayName: 'Acme Advisory', email: 'ap@example.test' },
      metadata,
    );
    const quote = await quotes.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [
          {
            description: 'Implementation advisory',
            quantity: '1',
            unitPriceMinor: '6000',
          },
          {
            description: 'Training workshop',
            quantity: '1',
            unitPriceMinor: '4000',
          },
        ],
      },
      metadata,
    );
    await quotes.submitForApproval(context, owner, quote.id, metadata);
    await quotes.approve(context, owner, quote.id, metadata);
    await quotes.send(context, owner, quote.id, metadata);
    const accepted = await quotes.accept(context, owner, quote.id, metadata);
    expect(accepted.status).toBe('ACCEPTED');

    const converted = await quotes.convertToInvoice(context, owner, quote.id, metadata);
    expect(converted.convertedInvoiceId).toBeTruthy();
    const issued = await invoices.issueInvoice(
      context,
      owner,
      converted.convertedInvoiceId!,
      metadata,
    );
    expect(issued.status).toBe('ISSUED');
    expect(issued.totalMinor).toBe('10000');

    const partialPayment = await payments.record(
      context,
      owner,
      { contactId: customer.id, receivedDate: '2026-02-10', amountMinor: '6000' },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      partialPayment.id,
      { allocations: [{ invoiceId: issued.id, amountMinor: '6000' }] },
      metadata,
    );
    const afterPartial = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(afterPartial.status).toBe('PARTIALLY_PAID');
    expect(afterPartial.balanceMinor).toBe(4000n);

    const finalPayment = await payments.record(
      context,
      owner,
      { contactId: customer.id, receivedDate: '2026-02-17', amountMinor: '4000' },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      finalPayment.id,
      { allocations: [{ invoiceId: issued.id, amountMinor: '4000' }] },
      metadata,
    );
    const paid = await harness.prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(paid.status).toBe('PAID');
    expect(paid.balanceMinor).toBe(0n);

    const bankAccount = await createFinancialAccount('Operating Account');
    const importResult = await statementImports.import(
      context,
      owner,
      bankAccount.id,
      uploadStatement(
        statementCsv([
          ['2026-02-10', 'Acme Advisory partial payment', 'ACME-PARTIAL', '6000'],
          ['2026-02-17', 'Acme Advisory final payment', 'ACME-FINAL', '4000'],
        ]),
      ),
      metadata,
    );
    expect(importResult.importedCount).toBe(2);
    expect(importResult.failedCount).toBe(0);

    const bankRows = await harness.prisma.bankTransaction.findMany({
      where: { organizationId: context.id, financialAccountId: bankAccount.id },
      orderBy: { transactionDate: 'asc' },
    });
    expect(bankRows).toHaveLength(2);
    await bankTransactions.match(
      context,
      owner,
      bankRows[0]!.id,
      { targetType: 'PAYMENT_RECEIVED', targetId: partialPayment.id },
      metadata,
    );
    await bankTransactions.match(
      context,
      owner,
      bankRows[1]!.id,
      { targetType: 'PAYMENT_RECEIVED', targetId: finalPayment.id },
      metadata,
    );

    const reconciliation = await reconciliations.start(
      context,
      owner,
      {
        financialAccountId: bankAccount.id,
        statementStartDate: '2026-02-01',
        statementEndDate: '2026-02-28',
        openingBalanceMinor: '0',
        closingBalanceMinor: '10000',
      },
      metadata,
    );
    const cleared = await reconciliations.setCleared(
      context,
      owner,
      reconciliation.id,
      { transactionIds: bankRows.map((row) => row.id) },
      metadata,
      true,
    );
    expect(cleared.difference).toBe('0');
    const completed = await reconciliations.complete(context, owner, reconciliation.id, metadata);
    expect(completed.status).toBe('COMPLETED');

    const [profitLoss, trialBalance, receivablesAging] = await Promise.all([
      reports.run(context.id, 'financial.profit-loss', reportRange()),
      reports.run(context.id, 'financial.trial-balance', reportRange()),
      reports.run(context.id, 'receivables.aging-summary', reportRange()),
    ]);
    expect(profitLoss.totals.amountMinor).toBe('10000');
    expect(receivablesAging.totals.amountMinor ?? '0').toBe('0');
    expect(trialBalance.totals.debitMinor).toBe('20000');
    expect(trialBalance.totals.creditMinor).toBe('20000');

    const [bank, receivable, revenue] = await Promise.all([
      ledger.accountBySystemKey(context.id, 'bank_default'),
      ledger.accountBySystemKey(context.id, 'accounts_receivable'),
      ledger.accountBySystemKey(context.id, 'sales_revenue'),
    ]);
    const trialByAccountId = new Map(trialBalance.rows.map((row) => [row.id, row.cells]));
    expect(trialByAccountId.get(bank.id)?.debitMinor).toBe('10000');
    expect(trialByAccountId.get(receivable.id)?.debitMinor).toBe('10000');
    expect(trialByAccountId.get(receivable.id)?.creditMinor).toBe('10000');
    expect(trialByAccountId.get(revenue.id)?.creditMinor).toBe('10000');
    expect(await postedAccountBalance(receivable.id)).toBe(0n);
    expect(await postedAccountBalance(bank.id)).toBe(10000n);
  });

  it('proves partial payment plus credit note allocation through statement, aging, and GL', async () => {
    const customer = await customers.create(
      context,
      owner,
      { displayName: 'Credit Flow Customer', email: 'credit-flow@example.test' },
      metadata,
    );
    const draftInvoice = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [{ description: 'Annual support package', quantity: '1', unitPriceMinor: '10000' }],
      },
      metadata,
    );
    const invoice = await invoices.issueInvoice(context, owner, draftInvoice.id, metadata);

    const partialPayment = await payments.record(
      context,
      owner,
      { contactId: customer.id, receivedDate: '2026-03-10', amountMinor: '3000' },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      partialPayment.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '3000' }] },
      metadata,
    );

    const creditDraft = await creditNotes.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [{ description: 'Service concession', quantity: '1', unitPriceMinor: '4000' }],
      },
      metadata,
    );
    const creditNote = await creditNotes.issueCreditNote(context, owner, creditDraft.id, metadata);
    const appliedCredit = await creditNotes.allocate(
      context,
      owner,
      creditNote.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '4000' }] },
      metadata,
    );
    expect(appliedCredit.status).toBe('APPLIED');
    expect(appliedCredit.remainingMinor).toBe('0');

    const invoiceAfterCredit = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(invoiceAfterCredit.status).toBe('PARTIALLY_PAID');
    expect(invoiceAfterCredit.balanceMinor).toBe(3000n);

    const statement = await statements.getStatement(context.id, customer.id, {});
    expect(statement.summary).toMatchObject({
      openingBalanceMinor: '0',
      closingBalanceMinor: '3000',
      invoicedMinor: '10000',
      paymentsAllocatedMinor: '3000',
      creditNotesAllocatedMinor: '4000',
    });
    const statementTypes = statement.transactions.map((row) => row.type).sort();
    expect(statementTypes).toEqual(
      [
        'INVOICE_ISSUED',
        'PAYMENT_RECEIVED',
        'PAYMENT_ALLOCATED',
        'CREDIT_NOTE_ISSUED',
        'CREDIT_NOTE_ALLOCATED',
      ].sort(),
    );

    const [profitLoss, trialBalance, receivablesAging] = await Promise.all([
      reports.run(context.id, 'financial.profit-loss', reportRange()),
      reports.run(context.id, 'financial.trial-balance', reportRange()),
      reports.run(context.id, 'receivables.aging-summary', reportRange()),
    ]);
    expect(profitLoss.totals.amountMinor).toBe('6000');
    expect(receivablesAging.totals.amountMinor).toBe('3000');
    expect(trialBalance.totals.debitMinor).toBe('21000');
    expect(trialBalance.totals.creditMinor).toBe('21000');

    const [bank, receivable, revenue, customerCredit] = await Promise.all([
      ledger.accountBySystemKey(context.id, 'bank_default'),
      ledger.accountBySystemKey(context.id, 'accounts_receivable'),
      ledger.accountBySystemKey(context.id, 'sales_revenue'),
      ledger.accountBySystemKey(context.id, 'customer_credit'),
    ]);
    const trialByAccountId = new Map(trialBalance.rows.map((row) => [row.id, row.cells]));
    expect(trialByAccountId.get(bank.id)?.debitMinor).toBe('3000');
    expect(trialByAccountId.get(receivable.id)?.debitMinor).toBe('10000');
    expect(trialByAccountId.get(receivable.id)?.creditMinor).toBe('7000');
    expect(trialByAccountId.get(revenue.id)?.debitMinor).toBe('4000');
    expect(trialByAccountId.get(revenue.id)?.creditMinor).toBe('10000');
    expect(trialByAccountId.get(customerCredit.id)?.debitMinor).toBe('4000');
    expect(trialByAccountId.get(customerCredit.id)?.creditMinor).toBe('4000');
    expect(await postedAccountBalance(receivable.id)).toBe(3000n);
    expect(await postedAccountBalance(bank.id)).toBe(3000n);
    expect(await postedAccountBalance(customerCredit.id)).toBe(0n);
  });

  it('proves foreign invoice settlement realizes FX and base-currency reports balance', async () => {
    await currencies.enable(context, owner, { currencyCode: 'USD' }, metadata);
    await currencies.upsertRate(
      context,
      owner,
      { quoteCurrency: 'USD', rateDate: '2026-01-01', rate: '10' },
      metadata,
    );
    const customer = await customers.create(
      context,
      owner,
      { displayName: 'Foreign Currency Customer', email: 'fx@example.test', currency: 'USD' },
      metadata,
    );
    const draftInvoice = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [
          { description: 'USD implementation package', quantity: '1', unitPriceMinor: '10000' },
        ],
      },
      metadata,
    );
    const invoice = await invoices.issueInvoice(context, owner, draftInvoice.id, metadata);
    expect(invoice.currency).toBe('USD');
    expect(invoice.exchangeRate).toBe('10');

    await currencies.upsertRate(
      context,
      owner,
      { quoteCurrency: 'USD', rateDate: '2026-09-13', rate: '12' },
      metadata,
    );
    const payment = await payments.record(
      context,
      owner,
      {
        contactId: customer.id,
        receivedDate: '2026-09-20',
        currency: 'USD',
        amountMinor: '10000',
      },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      payment.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '10000' }] },
      metadata,
    );

    const settled = await harness.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(settled.status).toBe('PAID');
    expect(settled.balanceMinor).toBe(0n);

    const [profitLoss, trialBalance, receivablesAging] = await Promise.all([
      reports.run(context.id, 'financial.profit-loss', {
        ...reportRange(),
        currencyMode: 'BASE',
      }),
      reports.run(context.id, 'financial.trial-balance', {
        ...reportRange(),
        currencyMode: 'BASE',
      }),
      reports.run(context.id, 'receivables.aging-summary', reportRange()),
    ]);
    expect(profitLoss.totals.amountMinor).toBe('120000');
    expect(receivablesAging.totals.amountMinor ?? '0').toBe('0');
    expect(trialBalance.totals.debitMinor).toBe('240000');
    expect(trialBalance.totals.creditMinor).toBe('240000');

    const [bank, receivable, revenue, fxGain] = await Promise.all([
      ledger.accountBySystemKey(context.id, 'bank_default'),
      ledger.accountBySystemKey(context.id, 'accounts_receivable'),
      ledger.accountBySystemKey(context.id, 'sales_revenue'),
      ledger.accountBySystemKey(context.id, 'fx_gain'),
    ]);
    const trialByAccountId = new Map(trialBalance.rows.map((row) => [row.id, row.cells]));
    expect(trialByAccountId.get(bank.id)?.debitMinor).toBe('120000');
    expect(trialByAccountId.get(receivable.id)?.debitMinor).toBe('120000');
    expect(trialByAccountId.get(receivable.id)?.creditMinor).toBe('120000');
    expect(trialByAccountId.get(revenue.id)?.creditMinor).toBe('100000');
    expect(trialByAccountId.get(fxGain.id)?.creditMinor).toBe('20000');
    expect(await postedAccountBalance(receivable.id)).toBe(0n);
    expect(await postedAccountBalance(bank.id)).toBe(120000n);
    expect(await postedAccountBalance(fxGain.id)).toBe(-20000n);
  });

  it('proves completed reconciliations can be period-locked and reopened with audit evidence', async () => {
    const customer = await customers.create(
      context,
      owner,
      { displayName: 'Lock Flow Customer', email: 'lock-flow@example.test' },
      metadata,
    );
    const payment = await payments.record(
      context,
      owner,
      { contactId: customer.id, receivedDate: '2026-09-12', amountMinor: '2500' },
      metadata,
    );
    const bankAccount = await createFinancialAccount('Month End Operating Account');
    await statementImports.import(
      context,
      owner,
      bankAccount.id,
      uploadStatement(statementCsv([['2026-09-12', 'Lock flow receipt', 'LOCK-RECEIPT', '2500']])),
      metadata,
    );
    const bankRow = await harness.prisma.bankTransaction.findFirstOrThrow({
      where: { organizationId: context.id, financialAccountId: bankAccount.id },
    });
    await bankTransactions.match(
      context,
      owner,
      bankRow.id,
      { targetType: 'PAYMENT_RECEIVED', targetId: payment.id },
      metadata,
    );

    const reconciliation = await reconciliations.start(
      context,
      owner,
      {
        financialAccountId: bankAccount.id,
        statementStartDate: '2026-09-01',
        statementEndDate: '2026-09-30',
        openingBalanceMinor: '0',
        closingBalanceMinor: '2500',
      },
      metadata,
    );
    await reconciliations.setCleared(
      context,
      owner,
      reconciliation.id,
      { transactionIds: [bankRow.id] },
      metadata,
      true,
    );
    const completed = await reconciliations.complete(context, owner, reconciliation.id, metadata);
    expect(completed.status).toBe('COMPLETED');

    const september = await periodByCode('FY2026-P09');
    await periods.close(context, owner, september.id, { note: 'September reconciled' }, metadata);
    const locked = await periods.lock(
      context,
      owner,
      september.id,
      { note: 'Board approved' },
      metadata,
    );
    expect(locked.status).toBe('LOCKED');

    const [bank, revenue] = await Promise.all([
      ledger.accountBySystemKey(context.id, 'bank_default'),
      ledger.accountBySystemKey(context.id, 'sales_revenue'),
    ]);
    const backdatedDraft = await ledger.createJournalDraft(context, owner, {
      journalDate: '2026-09-10',
      currency: baseCurrency,
      description: 'Backdated locked-period correction',
      lines: [
        { accountId: bank.id, debitMinor: '100', creditMinor: '0' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '100' },
      ],
    });
    await expect(ledger.postJournal(context, owner, backdatedDraft.id, metadata)).rejects.toThrow(
      'Fiscal period FY2026-P09 is not open.',
    );

    const unlockReason = 'Controller-approved correction window';
    const unlocked = await periods.unlock(
      context,
      owner,
      september.id,
      { note: unlockReason },
      metadata,
    );
    expect(unlocked.status).toBe('CLOSED');
    const unlockEvent = await harness.prisma.securityEvent.findFirstOrThrow({
      where: {
        organizationId: context.id,
        userId: owner.id,
        eventKey: 'periods.period_unlocked',
      },
      orderBy: { occurredAt: 'desc' },
    });
    expect(unlockEvent.metadata).toMatchObject({
      periodId: september.id,
      from: 'LOCKED',
      to: 'CLOSED',
      note: unlockReason,
    });

    await periods.reopen(
      context,
      owner,
      september.id,
      { note: 'Post approved correction' },
      metadata,
    );
    const postedCorrection = await ledger.postJournal(context, owner, backdatedDraft.id, metadata);
    expect(postedCorrection.status).toBe('POSTED');
    await periods.close(context, owner, september.id, { note: 'Correction posted' }, metadata);
    const relocked = await periods.lock(
      context,
      owner,
      september.id,
      { note: 'Final relock' },
      metadata,
    );
    expect(relocked.status).toBe('LOCKED');
  });

  it('proves approval rejection, resubmission, approval, and final posting history', async () => {
    const approver = await createMember('approval-scenario-approver');
    const policy = await approvals.createPolicy(
      context,
      owner,
      {
        name: 'Phase 14 invoice approval',
        targetType: 'INVOICE',
        priority: 0,
        allowSelfApproval: false,
        steps: [{ approverUserId: approver.user.id, label: 'Finance review' }],
      },
      metadata,
    );
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const customer = await customers.create(
      context,
      owner,
      { displayName: 'Approval Flow Customer', email: 'approval-flow@example.test' },
      metadata,
    );
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [{ description: 'Implementation sprint', quantity: '1', unitPriceMinor: '10000' }],
      },
      metadata,
    );
    const firstRequest = await approvalTargets.submit(
      context,
      owner,
      'INVOICE',
      draft.id,
      metadata,
    );
    await expect(invoices.issueInvoice(context, owner, draft.id, metadata)).rejects.toThrow(
      'This document is awaiting approval and cannot be finalized.',
    );

    await approvals.decide(
      approver.context,
      approver.user,
      firstRequest.id,
      { decision: 'REJECTED', comment: 'Revise the implementation estimate.' },
      metadata,
    );
    await invoices.updateDraft(
      context,
      owner,
      draft.id,
      {
        lines: [{ description: 'Implementation sprint', quantity: '1', unitPriceMinor: '9000' }],
      },
      metadata,
    );
    const secondRequest = await approvalTargets.submit(
      context,
      owner,
      'INVOICE',
      draft.id,
      metadata,
    );
    expect(secondRequest.id).not.toBe(firstRequest.id);
    const approved = await approvals.decide(
      approver.context,
      approver.user,
      secondRequest.id,
      { decision: 'APPROVED', comment: 'Approved after revision.' },
      metadata,
    );
    expect(approved.status).toBe('APPROVED');

    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);
    expect(issued.status).toBe('ISSUED');
    expect(issued.totalMinor).toBe('9000');
    const postedJournal = await harness.prisma.journal.findUniqueOrThrow({
      where: { id: issued.journalId! },
    });
    expect(postedJournal.status).toBe('POSTED');

    const mine = await approvals.submittedByMe(context, owner);
    expect(mine.map((request) => request.id)).toEqual([secondRequest.id, firstRequest.id]);
    expect(mine.map((request) => request.status)).toEqual(['APPROVED', 'REJECTED']);
    const rejectedDetail = await approvals.detail(context, firstRequest.id);
    expect(rejectedDetail.steps[0]?.decisions[0]).toMatchObject({
      decision: 'REJECTED',
      comment: 'Revise the implementation estimate.',
    });
    const approvedDetail = await approvals.detail(context, secondRequest.id);
    expect(approvedDetail.steps[0]?.decisions[0]).toMatchObject({
      decision: 'APPROVED',
      comment: 'Approved after revision.',
    });
  });

  it('proves real record IDs from another organization look identical to unknown IDs', async () => {
    const cookie = await sessionCookieFor(owner.id);
    const otherOwner = await createPublicUser(
      'cross-module-other-owner@example.test',
      'Cross Module Other Owner',
    );
    const otherOrganization = await organizations.create(
      otherOwner,
      {
        legalName: 'Other Scenario Tenant Ltd',
        businessType: 'LIMITED_COMPANY',
        countryCode: 'KE',
      },
      metadata,
    );
    const otherDraftContext = await access.requireMembership(otherOwner.id, otherOrganization.id);
    await organizations.finalize(otherDraftContext, otherOwner, metadata);
    const otherContext = await access.requireMembership(otherOwner.id, otherOrganization.id);
    await periods.generateFiscalYear(
      otherContext,
      otherOwner,
      { startsOn: '2026-01-01' },
      metadata,
    );
    const otherCustomer = await customers.create(
      otherContext,
      otherOwner,
      { displayName: 'Other Tenant Customer', email: 'other-customer@example.test' },
      metadata,
    );
    const otherInvoice = await invoices.createDraft(
      otherContext,
      otherOwner,
      {
        contactId: otherCustomer.id,
        lines: [{ description: 'Other tenant service', quantity: '1', unitPriceMinor: '1200' }],
      },
      metadata,
    );
    const otherPayment = await payments.record(
      otherContext,
      otherOwner,
      { contactId: otherCustomer.id, receivedDate: '2026-04-03', amountMinor: '1200' },
      metadata,
    );
    const unknownId = '00000000-0000-4000-8000-000000000001';

    for (const path of [
      `customers/${otherCustomer.id}`,
      `customers/${otherCustomer.id}/statement`,
      `invoices/${otherInvoice.id}`,
      `payments/${otherPayment.id}`,
    ]) {
      const unknownPath = path
        .replace(otherCustomer.id, unknownId)
        .replace(otherInvoice.id, unknownId)
        .replace(otherPayment.id, unknownId);
      const [foreign, unknown] = await Promise.all([
        harness.http().get(`${API}/organizations/${context.id}/${path}`).set('Cookie', cookie),
        harness
          .http()
          .get(`${API}/organizations/${context.id}/${unknownPath}`)
          .set('Cookie', cookie),
      ]);
      expect(foreign.status, path).toBe(404);
      expect(unknown.status, path).toBe(404);
      expect(foreign.body, path).toEqual(unknown.body);
      expect(JSON.stringify(foreign.body), path).not.toContain(otherCustomer.displayName);
    }
  });

  async function createFinancialAccount(name: string) {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    return financialAccounts.create(
      context,
      owner,
      { name, type: 'BANK', currency: baseCurrency, glAccountId: bank.id },
      metadata,
    );
  }

  async function postedAccountBalance(accountId: string) {
    const lines = await harness.prisma.journalLine.findMany({
      where: { organizationId: context.id, accountId, journal: { status: 'POSTED' } },
    });
    return lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n);
  }

  async function periodByCode(code: string) {
    return harness.prisma.fiscalPeriod.findFirstOrThrow({
      where: { organizationId: context.id, code },
    });
  }

  async function createMember(emailLocal: string) {
    const role = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId: context.id, key: 'ADMIN' },
    });
    const user = await createPublicUser(`${emailLocal}@example.test`, emailLocal);
    await harness.prisma.organizationMember.create({
      data: { organizationId: context.id, userId: user.id, roleId: role.id, status: 'ACTIVE' },
    });
    return { user, context: await access.requireMembership(user.id, context.id) };
  }

  async function createPublicUser(email: string, displayName: string): Promise<PublicUser> {
    const user = await harness.prisma.user.create({
      data: { email, displayName, emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
  }

  async function sessionCookieFor(userId: string): Promise<string> {
    const rawToken = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${rawToken}`;
  }
});

function reportRange() {
  return { from: '2026-01-01', to: '2026-12-31' };
}

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

function uploadStatement(csv: string) {
  return {
    originalname: 'service-scenario-statement.csv',
    mimetype: 'text/csv',
    size: Buffer.byteLength(csv),
    buffer: Buffer.from(csv, 'utf8'),
  };
}

function minorToDecimal(amountMinor: string): string {
  const negative = amountMinor.startsWith('-');
  const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
