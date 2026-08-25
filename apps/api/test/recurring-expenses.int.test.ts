import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { RecurringExpensesService } from '../src/purchases/recurring-expenses.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'recurring-expenses-test',
  userAgent: 'RetailBooks integration test',
};

describe('recurring expense generation against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let vendors: VendorsService;
  let recurringExpenses: RecurringExpensesService;
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
    vendors = harness.app.get(VendorsService);
    recurringExpenses = harness.app.get(RecurringExpensesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'recurring-expenses-owner@example.test',
        displayName: 'Recurring Expenses Owner',
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
      { legalName: 'Recurring Purchases Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const vendor = await vendors.create(context, owner, { displayName: 'Acme Supplies' }, metadata);
    vendorId = vendor.id;

    const paidThroughAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    paidThroughAccountId = paidThroughAccount.id;
  });

  it('generates exactly one expense for a due template, matching its amount, and advances nextRunDate', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        paidThroughAccountId,
        amountMinor: '2500',
      },
      metadata,
    );
    expect(template.nextRunDate).toBe('2026-01-15');

    const results = await recurringExpenses.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);
    expect(results[0]!.templateId).toBe(template.id);
    expect(results[0]!.expenseId).toBeTruthy();

    const expense = await harness.prisma.expense.findUniqueOrThrow({
      where: { id: results[0]!.expenseId! },
    });
    expect(expense.status).toBe('POSTED');
    expect(expense.amountMinor).toBe(2500n);
    expect(expense.payeeVendorId).toBe(vendorId);

    const updatedTemplate = await recurringExpenses.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2026-02-15');
  });

  it('generates an expense from a free-text payee name when no vendor is linked', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeName: 'Landlord Inc',
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        paidThroughAccountId,
        amountMinor: '2500',
      },
      metadata,
    );

    const results = await recurringExpenses.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);

    const expense = await harness.prisma.expense.findUniqueOrThrow({
      where: { id: results[0]!.expenseId! },
    });
    expect(expense.payeeVendorId).toBeNull();
    expect(expense.payeeName).toBe('Landlord Inc');

    const updatedTemplate = await recurringExpenses.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2026-02-15');
  });

  it('skips a template whose nextRunDate has not arrived yet', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        cadence: 'MONTHLY',
        startDate: '2099-01-15',
        paidThroughAccountId,
        amountMinor: '2500',
      },
      metadata,
    );

    const results = await recurringExpenses.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(0);

    const expenseCount = await harness.prisma.expense.count({
      where: { organizationId: context.id },
    });
    expect(expenseCount).toBe(0);

    const updatedTemplate = await recurringExpenses.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2099-01-15');
  });

  it('produces a draft-only expense when autoCreate is false', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        autoCreate: false,
        paidThroughAccountId,
        amountMinor: '2500',
      },
      metadata,
    );

    const results = await recurringExpenses.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);
    expect(results[0]!.templateId).toBe(template.id);

    const expense = await harness.prisma.expense.findUniqueOrThrow({
      where: { id: results[0]!.expenseId! },
    });
    expect(expense.status).toBe('DRAFT');
  });

  it('clamps a month-end start date to the last valid day of the next month instead of overflowing', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-31',
        paidThroughAccountId,
        amountMinor: '2500',
      },
      metadata,
    );
    expect(template.nextRunDate).toBe('2026-01-31');

    const results = await recurringExpenses.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);

    const updatedTemplate = await recurringExpenses.detail(context.id, template.id);
    // February 2026 has 28 days -- Date.prototype.setUTCMonth would otherwise overflow Jan 31 + 1
    // month into 2026-03-03 rather than clamping to the last valid day of February.
    expect(updatedTemplate.nextRunDate).toBe('2026-02-28');
  });

  it('deactivates a template whose next occurrence after generation would exceed endDate', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        cadence: 'WEEKLY',
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        paidThroughAccountId,
        amountMinor: '1000',
      },
      metadata,
    );

    const results = await recurringExpenses.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);

    const updatedTemplate = await recurringExpenses.detail(context.id, template.id);
    // startDate + 1 week = 2026-01-08, which is past the 2026-01-05 endDate.
    expect(updatedTemplate.nextRunDate).toBe('2026-01-08');
    expect(updatedTemplate.active).toBe(false);

    // A second sweep must not pick the now-inactive template back up.
    const secondRun = await recurringExpenses.runDueTemplates(context, owner, metadata);
    expect(secondRun).toHaveLength(0);

    const expenseCount = await harness.prisma.expense.count({
      where: { organizationId: context.id, payeeVendorId: vendorId },
    });
    expect(expenseCount).toBe(1);
  });

  it('concurrent double-trigger of runDueTemplates produces exactly one child expense for the same due template', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        paidThroughAccountId,
        amountMinor: '2500',
      },
      metadata,
    );

    const [first, second] = await Promise.all([
      recurringExpenses.runDueTemplates(context, owner, metadata),
      recurringExpenses.runDueTemplates(context, owner, metadata),
    ]);

    const generatedExpenseIds = [...first, ...second]
      .filter((result) => result.expenseId)
      .map((result) => result.expenseId!);
    expect(generatedExpenseIds).toHaveLength(1);

    const expenseCount = await harness.prisma.expense.count({
      where: { organizationId: context.id, payeeVendorId: vendorId },
    });
    expect(expenseCount).toBe(1);

    const updatedTemplate = await recurringExpenses.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2026-02-15');

    const claimCount = await harness.prisma.ledgerIdempotencyKey.count({
      where: { organizationId: context.id, operation: 'RECURRING_EXPENSE_GENERATE' },
    });
    expect(claimCount).toBe(1);
  });

  it('rejects creating a template for a deactivated vendor', async () => {
    await vendors.setStatus(context, owner, vendorId, 'INACTIVE', metadata);

    await expect(
      recurringExpenses.createTemplate(
        context,
        owner,
        {
          payeeVendorId: vendorId,
          cadence: 'MONTHLY',
          startDate: '2026-01-15',
          paidThroughAccountId,
          amountMinor: '2500',
        },
        metadata,
      ),
    ).rejects.toThrow('Cannot create a recurring template for a deactivated vendor.');
  });

  it('rejects updating a template onto a deactivated vendor', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        paidThroughAccountId,
        amountMinor: '2500',
      },
      metadata,
    );
    const otherVendor = await vendors.create(
      context,
      owner,
      { displayName: 'Deactivated Co' },
      metadata,
    );
    await vendors.setStatus(context, owner, otherVendor.id, 'INACTIVE', metadata);

    await expect(
      recurringExpenses.updateTemplate(
        context,
        owner,
        template.id,
        { payeeVendorId: otherVendor.id },
        metadata,
      ),
    ).rejects.toThrow('Cannot use a deactivated vendor.');
  });

  it('updates, deactivates, and reactivates a template', async () => {
    const template = await recurringExpenses.createTemplate(
      context,
      owner,
      {
        payeeVendorId: vendorId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        paidThroughAccountId,
        amountMinor: '2500',
      },
      metadata,
    );

    const updated = await recurringExpenses.updateTemplate(
      context,
      owner,
      template.id,
      { cadence: 'QUARTERLY', autoCreate: false, amountMinor: '3000' },
      metadata,
    );
    expect(updated.cadence).toBe('QUARTERLY');
    expect(updated.autoCreate).toBe(false);
    expect(updated.amountMinor).toBe('3000');

    const deactivated = await recurringExpenses.deactivate(context, owner, template.id, metadata);
    expect(deactivated.active).toBe(false);

    const reactivated = await recurringExpenses.reactivate(context, owner, template.id, metadata);
    expect(reactivated.active).toBe(true);
  });
});
