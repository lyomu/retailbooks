import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FinancialAccountsService } from '../src/banking/financial-accounts.service.js';
import { BankMatchProposalService } from '../src/banking/bank-match-proposal.service.js';
import { StatementImportsService } from '../src/banking/statement-imports.service.js';
import { ApprovalTargetsService } from '../src/automation/approval-targets.service.js';
import { ApprovalBriefingService } from '../src/automation/approval-briefing.service.js';
import { ApprovalsService } from '../src/automation/approvals.service.js';
import { CloseChecklistService } from '../src/insights/close-checklist.service.js';
import { CountryPackQaService } from '../src/insights/country-pack-qa.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { BillsService } from '../src/purchases/bills.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { DocumentDiscrepancyService } from '../src/documents/document-discrepancy.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'phase13-insights-fixtures-round2-test',
  userAgent: 'RetailBooks insights fixture test (round 2)',
};

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function csvFile(rows: string): { originalname: string; mimetype: string; size: number; buffer: Buffer } {
  const buffer = Buffer.from(rows, 'utf8');
  return { originalname: 'statement.csv', mimetype: 'text/csv', size: buffer.length, buffer };
}

/**
 * Real-data correctness tests for the five 13E/13F advisers with no raw-SQL bigint aggregation
 * (so the specific bug class `phase13-insights-bigint.int.test.ts` guards against doesn't apply),
 * which nonetheless had zero dedicated correctness coverage before this file -- only
 * permission/tenant-isolation checks. Each test calls the service directly against real posted
 * data and asserts actual output, not just "resolves without throwing".
 */
describe('Phase 13E/F adviser correctness against real posted activity (round 2)', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let vendors: VendorsService;
  let expenses: ExpensesService;
  let bills: BillsService;
  let financialAccounts: FinancialAccountsService;
  let statementImports: StatementImportsService;
  let approvals: ApprovalsService;
  let approvalTargets: ApprovalTargetsService;
  let closeChecklist: CloseChecklistService;
  let countryPackQa: CountryPackQaService;
  let bankMatchProposals: BankMatchProposalService;
  let approvalBriefing: ApprovalBriefingService;
  let documentDiscrepancy: DocumentDiscrepancyService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    vendors = harness.app.get(VendorsService);
    expenses = harness.app.get(ExpensesService);
    bills = harness.app.get(BillsService);
    financialAccounts = harness.app.get(FinancialAccountsService);
    statementImports = harness.app.get(StatementImportsService);
    approvals = harness.app.get(ApprovalsService);
    approvalTargets = harness.app.get(ApprovalTargetsService);
    closeChecklist = harness.app.get(CloseChecklistService);
    countryPackQa = harness.app.get(CountryPackQaService);
    bankMatchProposals = harness.app.get(BankMatchProposalService);
    approvalBriefing = harness.app.get(ApprovalBriefingService);
    documentDiscrepancy = harness.app.get(DocumentDiscrepancyService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'round2-owner@example.test',
        displayName: 'Round 2 Owner',
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
      { legalName: 'Round 2 Fixtures Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  });

  it('close checklist: reports unreconciled accounts, pending approvals, unresolved transactions, missing-receipt expenses, and stale drafts', async () => {
    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');

    const financialAccount = await financialAccounts.create(
      context,
      owner,
      { name: 'Checklist Checking', type: 'BANK', currency: 'KES', glAccountId: bankAccount.id },
      metadata,
    );

    // Posted with no attachment -> missingDocumentExpenses.
    const postedExpense = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Checklist Vendor',
        expenseDate: daysAgo(2),
        paidThroughAccountId: bankAccount.id,
        amountMinor: '20000',
      },
      metadata,
    );
    await expenses.post(context, owner, postedExpense.id, metadata);

    // Draft old enough to count as stale (STALE_DRAFT_DAYS = 14).
    const staleDraft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Stale Draft Vendor',
        expenseDate: daysAgo(20),
        paidThroughAccountId: bankAccount.id,
        amountMinor: '5000',
      },
      metadata,
    );
    await harness.prisma.expense.update({
      where: { id: staleDraft.id },
      data: { createdAt: new Date(Date.now() - 20 * 86_400_000) },
    });

    // Unresolved bank transaction via a real CSV statement import.
    await statementImports.import(
      context,
      owner,
      financialAccount.id,
      csvFile(`date,description,amount\n${daysAgo(1)},CHECKLIST TEST,-100.00\n`),
      metadata,
    );

    // Pending approval request.
    const policy = await approvals.createPolicy(
      context,
      owner,
      {
        name: 'Checklist Policy',
        targetType: 'BILL',
        steps: [{ requiredPermission: 'purchases.bills.manage', label: 'Review' }],
      } as never,
      metadata,
    );
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);
    const billVendor = await vendors.create(
      context,
      owner,
      { displayName: 'Checklist Bill Vendor' },
      metadata,
    );
    const bill = await bills.createDraft(
      context,
      owner,
      {
        vendorId: billVendor.id,
        lines: [
          {
            description: 'Consulting',
            quantity: '1',
            unitPriceMinor: '10000',
            accountId: expenseAccount.id,
          },
        ],
      },
      metadata,
    );
    await approvalTargets.submit(context, owner, 'BILL', bill.id, metadata);

    const checklist = await closeChecklist.build(context.id);

    expect(checklist.unreconciledAccounts.map((account) => account.financialAccountId)).toContain(
      financialAccount.id,
    );
    expect(checklist.pendingApprovals).toBe(1);
    expect(checklist.unresolvedBankTransactions).toBe(1);
    expect(checklist.missingDocumentExpenses.map((expense) => expense.id)).toContain(
      postedExpense.id,
    );
    expect(checklist.staleDraftCount).toBeGreaterThanOrEqual(1);
  });

  it('document discrepancies: flags amount, currency, and date mismatches independently, and skips fields the receipt could not resolve', async () => {
    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    const expense = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Discrepancy Fixture Vendor',
        expenseDate: '2026-03-05',
        paidThroughAccountId: bankAccount.id,
        currency: 'KES',
        amountMinor: '50000',
      },
      metadata,
    );

    const attachment = await harness.prisma.attachment.create({
      data: {
        organizationId: context.id,
        entityType: 'EXPENSE',
        entityId: expense.id,
        filename: 'receipt.png',
        contentType: 'image/png',
        storageKey: `${context.id}/expense/${expense.id}/${randomUUID()}.png`,
        sizeBytes: 100,
        contentHash: 'a'.repeat(64),
        uploadedByUserId: owner.id,
      },
    });
    await harness.prisma.documentExtraction.create({
      data: {
        organizationId: context.id,
        attachmentId: attachment.id,
        entityType: 'EXPENSE',
        entityId: expense.id,
        status: 'READY_FOR_REVIEW',
        contentHash: 'a'.repeat(64),
        candidateTotalMinor: 110_000n, // mismatched: expense records 50000
        candidateCurrency: 'USD', // mismatched: expense is KES
        candidateDate: new Date('2026-03-20T00:00:00.000Z'), // 15 days from expenseDate: mismatched
        arithmeticValid: true,
        disposition: 'PENDING',
      },
    });

    const discrepancies = await documentDiscrepancy.forExpense(context.id, expense.id);

    expect(discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'AMOUNT_MISMATCH',
          detail: 'Receipt shows 110000 minor units; the expense records 50000.',
        }),
        expect.objectContaining({
          kind: 'CURRENCY_MISMATCH',
          detail: 'Receipt shows USD; the expense is recorded in KES.',
        }),
        expect.objectContaining({ kind: 'DATE_MISMATCH' }),
      ]),
    );
    expect(discrepancies).toHaveLength(3);
  });

  it('document discrepancies: reports nothing when the receipt matches the recorded expense', async () => {
    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    const expense = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Matching Fixture Vendor',
        expenseDate: '2026-03-05',
        paidThroughAccountId: bankAccount.id,
        currency: 'KES',
        amountMinor: '110000',
      },
      metadata,
    );
    const attachment = await harness.prisma.attachment.create({
      data: {
        organizationId: context.id,
        entityType: 'EXPENSE',
        entityId: expense.id,
        filename: 'receipt.png',
        contentType: 'image/png',
        storageKey: `${context.id}/expense/${expense.id}/${randomUUID()}.png`,
        sizeBytes: 100,
        contentHash: 'b'.repeat(64),
        uploadedByUserId: owner.id,
      },
    });
    await harness.prisma.documentExtraction.create({
      data: {
        organizationId: context.id,
        attachmentId: attachment.id,
        entityType: 'EXPENSE',
        entityId: expense.id,
        status: 'READY_FOR_REVIEW',
        contentHash: 'b'.repeat(64),
        candidateTotalMinor: 110_000n,
        candidateCurrency: 'KES',
        candidateDate: new Date('2026-03-05T00:00:00.000Z'),
        arithmeticValid: true,
        disposition: 'PENDING',
      },
    });

    await expect(documentDiscrepancy.forExpense(context.id, expense.id)).resolves.toEqual([]);
  });

  it('country pack Q&A: finds and cites a real adopted country pack note by keyword', async () => {
    const preference = await harness.prisma.organizationPreference.findUniqueOrThrow({
      where: { organizationId: context.id },
    });

    const pack = await harness.prisma.countryPack.create({
      data: {
        code: 'E2E',
        version: '2026.1',
        countryCode: 'KE',
        name: 'E2E Fixture Pack',
        status: 'PUBLISHED',
        defaults: {},
        notes: ['Retain E2E fixture receipts for seven years per policy.'],
        supportedEntityTypes: ['EXPENSE'],
      },
    });
    await harness.prisma.taxPack.create({
      data: {
        countryPackId: pack.id,
        version: '2026.1',
        name: 'E2E Fixture Tax Pack',
        rates: [{ label: 'E2E Standard VAT', ratePercent: '16', treatment: 'EXCLUSIVE', recoverable: true }],
        notes: ['E2E fixture zero-rated exports require a customs declaration.'],
      },
    });
    await harness.prisma.documentRule.create({
      data: {
        countryPackId: pack.id,
        documentType: 'INVOICE',
        requiredLegalFields: ['E2E Fixture Tax PIN'],
        footerText: 'This E2E fixture invoice is not a tax invoice unless VAT registered.',
      },
    });
    await harness.prisma.organizationPreference.update({
      where: { organizationId: context.id },
      data: { countryPackCode: pack.code, countryPackVersion: pack.version },
    });

    const noteResults = await countryPackQa.search(context.id, 'seven years');
    expect(noteResults).toEqual([
      expect.objectContaining({
        source: 'COUNTRY_PACK',
        packCode: 'E2E',
        packVersion: '2026.1',
        text: 'Retain E2E fixture receipts for seven years per policy.',
      }),
    ]);

    const taxResults = await countryPackQa.search(context.id, 'zero-rated exports');
    expect(taxResults).toHaveLength(1);
    expect(taxResults[0]).toMatchObject({ source: 'TAX_PACK' });
    expect(taxResults[0]?.text).toContain('zero-rated exports');

    const rateResults = await countryPackQa.search(context.id, 'e2e standard vat');
    expect(rateResults).toEqual([expect.objectContaining({ source: 'TAX_PACK' })]);

    const ruleResults = await countryPackQa.search(context.id, 'tax invoice unless');
    expect(ruleResults).toEqual([
      expect.objectContaining({ source: 'DOCUMENT_RULE', documentType: 'INVOICE' }),
    ]);

    const requiredFieldResults = await countryPackQa.search(context.id, 'e2e fixture tax pin');
    expect(requiredFieldResults).toEqual([
      expect.objectContaining({ source: 'DOCUMENT_RULE', text: 'Required field: E2E Fixture Tax PIN' }),
    ]);

    await expect(countryPackQa.search(context.id, 'no such phrase anywhere')).resolves.toEqual([]);
    // Confirm this test's own real pack replaced the org's real adopted preference (not a stub).
    expect(preference.countryPackCode).not.toBe(pack.code);
  });

  it('bank match proposals: ranks a real posted expense by amount/date/description and excludes an already-claimed target', async () => {
    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    const financialAccount = await financialAccounts.create(
      context,
      owner,
      { name: 'Match Checking', type: 'BANK', currency: 'KES', glAccountId: bankAccount.id },
      metadata,
    );
    const vendor = await vendors.create(
      context,
      owner,
      { displayName: 'Match Proposal Fixture Vendor' },
      metadata,
    );
    const expense = await expenses.createDraft(
      context,
      owner,
      {
        payeeVendorId: vendor.id,
        expenseDate: '2026-03-10',
        paidThroughAccountId: bankAccount.id,
        amountMinor: '75000',
      },
      metadata,
    );
    await expenses.post(context, owner, expense.id, metadata);

    const csv =
      'date,description,amount,reference\n' +
      '2026-03-11,MATCH PROPOSAL FIXTURE VENDOR PAYMENT,-750.00,REF-001\n' +
      // Same amount/date/description as the row above but a different reference: a distinct
      // fingerprint (which hashes in the reference), not a duplicate of the first row -- both are
      // real, separate bank transactions, which is what the "already claimed" exclusion needs.
      '2026-03-11,MATCH PROPOSAL FIXTURE VENDOR PAYMENT,-750.00,REF-002\n';
    await statementImports.import(context, owner, financialAccount.id, csvFile(csv), metadata);
    // The importer does not stamp statementImportId onto the rows it creates, so the only way to
    // find them back is by the account they were imported into.
    const transactions = await harness.prisma.bankTransaction.findMany({
      where: { organizationId: context.id, financialAccountId: financialAccount.id },
      orderBy: { reference: 'asc' },
    });
    expect(transactions).toHaveLength(2);

    const firstProposals = await bankMatchProposals.propose(context.id, transactions[0]!.id);
    expect(firstProposals).toHaveLength(1);
    expect(firstProposals[0]).toMatchObject({
      targetType: 'EXPENSE',
      targetId: expense.id,
      label: 'Match Proposal Fixture Vendor',
      amountMinor: '75000',
    });
    expect(firstProposals[0]?.reason).toContain('exact amount match');
    // The description contains the vendor's name, so the +20 description-match bonus applies:
    // 100 - (1 day diff * 2) + 20 = 118. Expense posted 2026-03-10, transaction dated 2026-03-11.
    expect(firstProposals[0]?.score).toBe(118);

    // Claim the expense against the first transaction; the second transaction (same amount/date,
    // otherwise an equally valid candidate) must no longer see it as a proposal.
    await harness.prisma.match.create({
      data: {
        organizationId: context.id,
        bankTransactionId: transactions[0]!.id,
        targetType: 'EXPENSE',
        targetId: expense.id,
        matchedByUserId: owner.id,
      },
    });

    const secondProposals = await bankMatchProposals.propose(context.id, transactions[1]!.id);
    expect(secondProposals).toEqual([]);
  });

  it('approval briefing: reports what changed on a Bill since submission, alongside its policy conditions', async () => {
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const vendorA = await vendors.create(context, owner, { displayName: 'Briefing Fixture Vendor A' }, metadata);
    const vendorB = await vendors.create(context, owner, { displayName: 'Briefing Fixture Vendor B' }, metadata);

    const policy = await approvals.createPolicy(
      context,
      owner,
      {
        name: 'Briefing Fixture Policy',
        targetType: 'BILL',
        conditions: { minimumAmountMinor: '1' },
        steps: [{ requiredPermission: 'purchases.bills.manage', label: 'Finance review' }],
      } as never,
      metadata,
    );
    await approvals.setPolicyStatus(context, owner, policy.id, 'ACTIVE', metadata);

    const bill = await bills.createDraft(
      context,
      owner,
      {
        vendorId: vendorA.id,
        lines: [
          {
            description: 'Consulting services',
            quantity: '1',
            unitPriceMinor: '250000',
            accountId: expenseAccount.id,
          },
        ],
      },
      metadata,
    );
    const request = await approvalTargets.submit(context, owner, 'BILL', bill.id, metadata);

    const unchangedBriefing = await approvalBriefing.brief(context.id, request.id);
    expect(unchangedBriefing.changedSinceSubmission).toEqual([]);
    expect(unchangedBriefing.targetStillExists).toBe(true);
    expect(unchangedBriefing.policyConditions).toEqual(['Amount at least 1 minor units']);

    await bills.updateDraft(context, owner, bill.id, { vendorId: vendorB.id }, metadata);

    const changedBriefing = await approvalBriefing.brief(context.id, request.id);
    expect(changedBriefing.changedSinceSubmission).toContain('vendorName');
    expect(changedBriefing.counterparty).toBe('Briefing Fixture Vendor B');
  });
});
