import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { TaxService } from '../src/organizations/tax.service.js';
import { ExpenseCategoriesService } from '../src/purchases/expense-categories.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'expenses-test',
  userAgent: 'RetailBooks integration test',
};

describe('expense posting and expense categories against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let tax: TaxService;
  let vendors: VendorsService;
  let categories: ExpenseCategoriesService;
  let expenses: ExpensesService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let vendorId: string;
  let paidThroughAccountId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    tax = harness.app.get(TaxService);
    vendors = harness.app.get(VendorsService);
    categories = harness.app.get(ExpenseCategoriesService);
    expenses = harness.app.get(ExpensesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'expenses-owner@example.test',
        displayName: 'Expenses Owner',
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
      { legalName: 'Expense Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const vendor = await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
    vendorId = vendor.id;

    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    paidThroughAccountId = bankAccount.id;
  });

  async function accountByCode(code: string) {
    return harness.prisma.ledgerAccount.findFirstOrThrow({
      where: { organizationId: context.id, code },
    });
  }

  async function officeSuppliesCategory() {
    const account = await accountByCode('5060'); // Office supplies
    return categories.create(
      context,
      owner,
      { name: 'Office supplies', accountId: account.id },
      metadata,
    );
  }

  it('posts a debit-category-account / credit-paid-through-account journal with no AP leg', async () => {
    const category = await officeSuppliesCategory();
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        categoryId: category.id,
        amountMinor: '5000',
      },
      metadata,
    );
    expect(draft.status).toBe('DRAFT');

    const posted = await expenses.post(context, owner, draft.id, metadata);
    expect(posted.status).toBe('POSTED');
    expect(posted.expenseNumber).toMatch(/^EXP-/);
    expect(posted.totalMinor).toBe('5000');

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: posted.journalId! },
      include: { lines: true },
    });
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(5000n);
    expect(journal.lines).toHaveLength(2);

    const categoryAccount = await accountByCode('5060');
    const categoryLine = journal.lines.find((line) => line.accountId === categoryAccount.id);
    expect(categoryLine?.debitMinor).toBe(5000n);
    expect(categoryLine?.creditMinor).toBe(0n);

    const paidThroughLine = journal.lines.find((line) => line.accountId === paidThroughAccountId);
    expect(paidThroughLine?.creditMinor).toBe(5000n);
    expect(paidThroughLine?.debitMinor).toBe(0n);

    // No AP leg at all -- confirm accounts_payable is untouched by this posting.
    const apAccount = await ledger.accountBySystemKey(context.id, 'accounts_payable');
    expect(journal.lines.some((line) => line.accountId === apAccount.id)).toBe(false);
  });

  it('falls back to the general_expense system account when the expense has no category', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '1200',
      },
      metadata,
    );

    const posted = await expenses.post(context, owner, draft.id, metadata);

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: posted.journalId! },
      include: { lines: true },
    });
    const generalExpenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const expenseLine = journal.lines.find((line) => line.accountId === generalExpenseAccount.id);
    expect(expenseLine?.debitMinor).toBe(1200n);
  });

  it('posts a balanced category/tax-debit, paid-through-credit journal for a recoverable tax code', async () => {
    const category = await officeSuppliesCategory();
    const taxCode = await tax.createTaxCode(
      context,
      owner,
      { code: 'VAT-P', name: 'Purchase VAT', treatment: 'EXCLUSIVE', recoverable: true },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      taxCode.id,
      { ratePercent: '10', effectiveFrom: '2026-01-01' },
      metadata,
    );

    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        categoryId: category.id,
        amountMinor: '10000',
        taxCodeId: taxCode.id,
      },
      metadata,
    );

    const posted = await expenses.post(context, owner, draft.id, metadata);
    // 10000 taxable @ 10% = 1000 tax; total = 11000.
    expect(posted.taxAmountMinor).toBe('1000');
    expect(posted.totalMinor).toBe('11000');

    const journal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: posted.journalId! },
      include: { lines: true },
    });
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(11000n);
    expect(journal.lines).toHaveLength(3);

    const categoryAccount = await accountByCode('5060');
    const categoryLine = journal.lines.find((line) => line.accountId === categoryAccount.id);
    expect(categoryLine?.debitMinor).toBe(10000n);

    // No purchaseTaxAccountId configured on the tax code -> falls back to the tax_receivable system
    // account, mirroring the sales-side tax_payable fallback pattern in invoices.int.test.ts.
    const taxReceivableAccount = await ledger.accountBySystemKey(context.id, 'tax_receivable');
    const taxLine = journal.lines.find((line) => line.accountId === taxReceivableAccount.id);
    expect(taxLine?.debitMinor).toBe(1000n);
    expect(taxLine?.creditMinor).toBe(0n);

    const paidThroughLine = journal.lines.find((line) => line.accountId === paidThroughAccountId);
    expect(paidThroughLine?.creditMinor).toBe(11000n);

    const apAccount = await ledger.accountBySystemKey(context.id, 'accounts_payable');
    expect(journal.lines.some((line) => line.accountId === apAccount.id)).toBe(false);
  });

  it('posts straight from DRAFT', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '500',
      },
      metadata,
    );
    expect(draft.status).toBe('DRAFT');
    const posted = await expenses.post(context, owner, draft.id, metadata);
    expect(posted.status).toBe('POSTED');
  });

  it('posts from APPROVED (submit -> approve -> post)', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '500',
      },
      metadata,
    );
    const submitted = await expenses.submit(context, owner, draft.id, metadata);
    expect(submitted.status).toBe('PENDING_APPROVAL');
    const approved = await expenses.approve(context, owner, draft.id, metadata);
    expect(approved.status).toBe('APPROVED');

    const posted = await expenses.post(context, owner, draft.id, metadata);
    expect(posted.status).toBe('POSTED');
  });

  it('rejects posting an expense that is only pending approval', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '500',
      },
      metadata,
    );
    await expenses.submit(context, owner, draft.id, metadata);

    await expect(expenses.post(context, owner, draft.id, metadata)).rejects.toThrow(
      'Only draft or approved expenses can be posted.',
    );
  });

  it('rejects posting an already-posted expense', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '500',
      },
      metadata,
    );
    await expenses.post(context, owner, draft.id, metadata);

    await expect(expenses.post(context, owner, draft.id, metadata)).rejects.toThrow(
      'Only draft or approved expenses can be posted.',
    );
  });

  it('rejects posting a voided expense', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '500',
      },
      metadata,
    );
    const posted = await expenses.post(context, owner, draft.id, metadata);
    await expenses.voidExpense(context, owner, posted.id, metadata);

    await expect(expenses.post(context, owner, posted.id, metadata)).rejects.toThrow(
      'Only draft or approved expenses can be posted.',
    );
  });

  it('voids a posted expense with an exact-reversal journal', async () => {
    const category = await officeSuppliesCategory();
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        categoryId: category.id,
        amountMinor: '3000',
      },
      metadata,
    );
    const posted = await expenses.post(context, owner, draft.id, metadata);

    const voided = await expenses.voidExpense(context, owner, posted.id, metadata);
    expect(voided.status).toBe('VOID');
    expect(voided.voidedAt).not.toBeNull();

    const originalJournal = await harness.prisma.journal.findFirstOrThrow({
      where: { id: posted.journalId! },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    expect(originalJournal.status).toBe('REVERSED');

    const reversalJournal = await harness.prisma.journal.findFirstOrThrow({
      where: { reversalOfJournalId: originalJournal.id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    expect(reversalJournal.status).toBe('POSTED');
    for (const [index, line] of originalJournal.lines.entries()) {
      const reversedLine = reversalJournal.lines[index]!;
      expect(reversedLine.accountId).toBe(line.accountId);
      expect(reversedLine.debitMinor).toBe(line.creditMinor);
      expect(reversedLine.creditMinor).toBe(line.debitMinor);
    }
  });

  it('rejects voiding a draft expense', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '500',
      },
      metadata,
    );
    await expect(expenses.voidExpense(context, owner, draft.id, metadata)).rejects.toThrow(
      'Only posted expenses can be voided.',
    );
  });

  it('rejects creating an expense for a deactivated vendor', async () => {
    await vendors.setStatus(context, owner, vendorId, 'INACTIVE', metadata);

    await expect(
      expenses.createDraft(
        context,
        owner,
        {
          payeeVendorId: vendorId,
          expenseDate: '2026-02-01',
          paidThroughAccountId,
          amountMinor: '500',
        },
        metadata,
      ),
    ).rejects.toThrow('Cannot record an expense for a deactivated vendor.');
  });

  it('rejects updating a draft expense to reference a deactivated vendor', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Cash purchase',
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '500',
      },
      metadata,
    );
    await vendors.setStatus(context, owner, vendorId, 'INACTIVE', metadata);

    await expect(
      expenses.updateDraft(context, owner, draft.id, { payeeVendorId: vendorId }, metadata),
    ).rejects.toThrow('Cannot record an expense for a deactivated vendor.');
  });

  it('allows creating and updating an expense against an active vendor', async () => {
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        expenseDate: '2026-02-01',
        paidThroughAccountId,
        amountMinor: '500',
      },
      metadata,
    );
    expect(draft.payeeVendorId).toBe(vendorId);

    const updated = await expenses.updateDraft(
      context,
      owner,
      draft.id,
      { amountMinor: '750' },
      metadata,
    );
    expect(updated.amountMinor).toBe('750');
  });

  it('rejects an expense with neither a vendor nor a free-text payee name', async () => {
    await expect(
      expenses.createDraft(
        context,
        owner,
        {
          expenseDate: '2026-02-01',
          paidThroughAccountId,
          amountMinor: '500',
        },
        metadata,
      ),
    ).rejects.toThrow('An expense needs a vendor or a free-text payee name.');
  });

  it('creates, lists, and updates expense categories mapped to a chart-of-accounts entry', async () => {
    const officeAccount = await accountByCode('5060');
    const travelAccount = await accountByCode('5090');

    const created = await categories.create(
      context,
      owner,
      { name: 'Office supplies', accountId: officeAccount.id },
      metadata,
    );
    expect(created.name).toBe('Office supplies');
    expect(created.accountId).toBe(officeAccount.id);
    expect(created.active).toBe(true);

    await categories.create(
      context,
      owner,
      { name: 'Travel', accountId: travelAccount.id },
      metadata,
    );

    const list = await categories.list(context.id);
    expect(list.map((category) => category.name)).toEqual(['Office supplies', 'Travel']);

    const updated = await categories.update(
      context,
      owner,
      created.id,
      { name: 'Office supplies (renamed)', accountId: travelAccount.id, active: false },
      metadata,
    );
    expect(updated.name).toBe('Office supplies (renamed)');
    expect(updated.accountId).toBe(travelAccount.id);
    expect(updated.active).toBe(false);
  });

  it('rejects creating a second expense category with the same name', async () => {
    const officeAccount = await accountByCode('5060');
    await categories.create(
      context,
      owner,
      { name: 'Office supplies', accountId: officeAccount.id },
      metadata,
    );

    await expect(
      categories.create(
        context,
        owner,
        { name: 'Office supplies', accountId: officeAccount.id },
        metadata,
      ),
    ).rejects.toThrow('An expense category with this name already exists.');
  });
});
