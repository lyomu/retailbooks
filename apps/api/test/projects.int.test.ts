import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { ProjectsService } from '../src/projects/projects.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { PaymentsService } from '../src/sales/payments.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'projects-test',
  userAgent: 'RetailBooks integration test',
};

describe('projects, time, and billing against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let projects: ProjectsService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let payments: PaymentsService;
  let expenses: ExpensesService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    projects = harness.app.get(ProjectsService);
    customers = harness.app.get(CustomersService);
    invoices = harness.app.get(InvoicesService);
    payments = harness.app.get(PaymentsService);
    expenses = harness.app.get(ExpensesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'projects-owner@example.test',
        displayName: 'Projects Owner',
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
      { legalName: 'Projects Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  });

  // --- timesheet immutability ---------------------------------------------------------------

  it('locks a time entry on submit and releases it only through rejection or unlock', async () => {
    const project = await createProject();
    const entry = await recordTime(project.id, '4.00');

    // Draft time is the recorder's to change.
    const edited = await projects.updateTimeEntry(
      context,
      owner,
      entry.id,
      { hours: '5.00' },
      metadata,
    );
    expect(edited.hours).toBe('5');

    await projects.submitTime(context, owner, { timeEntryIds: [entry.id] }, metadata);
    await expect(
      projects.updateTimeEntry(context, owner, entry.id, { hours: '9.00' }, metadata),
    ).rejects.toThrow(/submitted/i);
    await expect(projects.deleteTimeEntry(context, owner, entry.id)).rejects.toThrow(/submitted/i);

    // Rejection is one of the two doors back out, and it carries the reason with it.
    const [rejected] = await projects.rejectTime(
      context,
      owner,
      { timeEntryIds: [entry.id], comment: 'Wrong task' },
      metadata,
    );
    expect(rejected?.status).toBe('REJECTED');
    expect(rejected?.decisionComment).toBe('Wrong task');

    // Editing a rejected entry returns it to draft rather than leaving it re-approvable as-is:
    // the approver must see the corrected version as a fresh submission.
    const corrected = await projects.updateTimeEntry(
      context,
      owner,
      entry.id,
      { hours: '6.00' },
      metadata,
    );
    expect(corrected.status).toBe('DRAFT');
    expect(corrected.decisionComment).toBeNull();

    await projects.submitTime(context, owner, { timeEntryIds: [entry.id] }, metadata);
    await projects.approveTime(context, owner, { timeEntryIds: [entry.id] }, metadata);
    await expect(
      projects.updateTimeEntry(context, owner, entry.id, { hours: '7.00' }, metadata),
    ).rejects.toThrow(/approved/i);

    // Unlock is the other door, and it clears the approval trail so the entry starts over.
    const [unlocked] = await projects.unlockTime(
      context,
      owner,
      { timeEntryIds: [entry.id], comment: 'Reopened for correction' },
      metadata,
    );
    expect(unlocked?.status).toBe('DRAFT');
    expect(unlocked?.approvedAt).toBeNull();
    expect(unlocked?.submittedAt).toBeNull();
  });

  it('refuses to approve time that was never submitted', async () => {
    const project = await createProject();
    const entry = await recordTime(project.id, '2.00');
    await expect(
      projects.approveTime(context, owner, { timeEntryIds: [entry.id] }, metadata),
    ).rejects.toThrow(/submitted/i);
  });

  // --- invoiced exactly once ------------------------------------------------------------------

  it('bills approved time exactly once and refuses to bill it again', async () => {
    const customer = await createCustomer();
    const project = await createProject({ customerId: customer.id, defaultRateMinor: '10000' });
    const entry = await approvedTime(project.id, '3.00');

    const billables = await projects.listBillables(context.id, project.id);
    expect(billables).toHaveLength(1);
    expect(billables[0]?.lineTotalMinor).toBe('30000');

    const invoice = await projects.generateInvoice(context, owner, project.id, {}, metadata);
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.totalMinor).toBe('30000');

    const claimed = await harness.prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(claimed.status).toBe('INVOICED');
    expect(claimed.invoiceLineId).not.toBeNull();

    // The entry is no longer billable, and asking to bill it by id is rejected rather than
    // silently producing an empty invoice.
    expect(await projects.listBillables(context.id, project.id)).toHaveLength(0);
    await expect(
      projects.generateInvoice(context, owner, project.id, { timeEntryIds: [entry.id] }, metadata),
    ).rejects.toThrow(/nothing approved and unbilled/i);

    // Exactly one invoice exists: the second attempt created nothing on its way to failing.
    expect(await harness.prisma.invoice.count({ where: { organizationId: context.id } })).toBe(1);
  });

  it('bills a project expense exactly once and refuses to bill it again', async () => {
    const customer = await createCustomer();
    const project = await createProject({ customerId: customer.id });
    const link = await billableExpense(project.id, '4000', '25');

    // 4000 with a 25% markup is what the customer is charged; 4000 is what it cost.
    expect(link.billableAmountMinor).toBe('5000');
    expect(link.amountMinor).toBe('4000');

    const invoice = await projects.generateInvoice(context, owner, project.id, {}, metadata);
    expect(invoice.totalMinor).toBe('5000');

    const claimed = await harness.prisma.projectExpense.findUniqueOrThrow({
      where: { id: link.id },
    });
    expect(claimed.invoiceLineId).not.toBeNull();

    await expect(
      projects.generateInvoice(
        context,
        owner,
        project.id,
        { projectExpenseIds: [link.id] },
        metadata,
      ),
    ).rejects.toThrow(/nothing approved and unbilled/i);

    // An invoiced expense is frozen against detaching and re-marking, which is what would
    // otherwise let the same spend be rebilled through a second link.
    await expect(projects.unlinkExpense(context, owner, link.id)).rejects.toThrow(/invoiced/i);
    await expect(
      projects.updateProjectExpense(context, owner, link.id, { billable: false }, metadata),
    ).rejects.toThrow(/invoiced/i);
  });

  it('refuses to attach one expense to two projects', async () => {
    const first = await createProject({ name: 'First' });
    const second = await createProject({ name: 'Second' });
    const expense = await postedExpense('3000', first.id);

    await projects.linkExpense(context, owner, first.id, { expenseId: expense.id }, metadata);
    await expect(
      projects.linkExpense(context, owner, second.id, { expenseId: expense.id }, metadata),
    ).rejects.toThrow(/already attached/i);
  });

  it('refuses to rebill an expense through a project other than the one it costed', async () => {
    const costed = await createProject({ name: 'Costed' });
    const other = await createProject({ name: 'Other' });
    const expense = await postedExpense('3000', costed.id);

    // The cost is already frozen on the ledger against `costed`. Letting the rebilling link name
    // `other` would bill one project for another's cost, and no later edit can move the posted line.
    await expect(
      projects.linkExpense(context, owner, other.id, { expenseId: expense.id }, metadata),
    ).rejects.toThrow(/different project/i);
  });

  it('refuses to rebill an expense that posted without a project at all', async () => {
    const project = await createProject();
    const expense = await postedExpense('3000');
    await expect(
      projects.linkExpense(context, owner, project.id, { expenseId: expense.id }, metadata),
    ).rejects.toThrow(/without a project/i);
  });

  it('returns the first invoice when the generate call is replayed with the same idempotency key', async () => {
    const customer = await createCustomer();
    const project = await createProject({ customerId: customer.id, defaultRateMinor: '10000' });
    await approvedTime(project.id, '2.00');

    const first = await projects.generateInvoice(
      context,
      owner,
      project.id,
      {},
      metadata,
      'generate-once',
    );
    const replay = await projects.generateInvoice(
      context,
      owner,
      project.id,
      {},
      metadata,
      'generate-once',
    );

    expect(replay.id).toBe(first.id);
    expect(await harness.prisma.invoice.count({ where: { organizationId: context.id } })).toBe(1);
  });

  // --- dimension freezing ---------------------------------------------------------------------

  it('freezes the project dimension on posted lines and carries it through a reversal', async () => {
    const customer = await createCustomer();
    const project = await createProject({ customerId: customer.id, defaultRateMinor: '10000' });
    const other = await createProject({ name: 'Other project', customerId: customer.id });
    await approvedTime(project.id, '1.00');

    const invoice = await projects.generateInvoice(context, owner, project.id, {}, metadata);
    const revenueLines = await dimensionedLines(project.id, 'REVENUE');
    expect(revenueLines).toHaveLength(1);
    expect(revenueLines[0]?.creditMinor).toBe(10000n);

    // Re-tag the source document to a different project. A posted period must not move.
    await harness.prisma.invoiceLine.updateMany({
      where: { invoiceId: invoice.id },
      data: { projectId: other.id },
    });
    expect(await dimensionedLines(project.id, 'REVENUE')).toHaveLength(1);
    expect(await dimensionedLines(other.id, 'REVENUE')).toHaveLength(0);

    // Voiding reverses through the ledger. The reversal must carry the dimension, or the project
    // would be left holding revenue with nothing to offset it.
    await invoices.voidInvoice(context, owner, invoice.id, metadata);
    const afterVoid = await dimensionedLines(project.id, 'REVENUE');
    expect(afterVoid).toHaveLength(2);
    const net = afterVoid.reduce((sum, line) => sum + line.creditMinor - line.debitMinor, 0n);
    expect(net).toBe(0n);
  });

  it('keeps two projects sharing a revenue account on separate journal lines', async () => {
    const customer = await createCustomer();
    const first = await createProject({ name: 'Alpha', customerId: customer.id });
    const second = await createProject({ name: 'Beta', customerId: customer.id });

    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: customer.id,
        lines: [
          { description: 'Alpha work', quantity: '1', unitPriceMinor: '1000', projectId: first.id },
          { description: 'Beta work', quantity: '1', unitPriceMinor: '2000', projectId: second.id },
        ],
      },
      metadata,
    );
    await invoices.issueInvoice(context, owner, draft.id, metadata);

    // Both lines use the same default revenue account. Grouping by account alone would have
    // collapsed them into one line and forced the dimension to be dropped or arbitrarily picked.
    const alpha = await dimensionedLines(first.id, 'REVENUE');
    const beta = await dimensionedLines(second.id, 'REVENUE');
    expect(alpha).toHaveLength(1);
    expect(beta).toHaveLength(1);
    expect(alpha[0]?.accountId).toBe(beta[0]?.accountId);
    expect(alpha[0]?.creditMinor).toBe(1000n);
    expect(beta[0]?.creditMinor).toBe(2000n);
  });

  // --- cross-module scenario 3 -----------------------------------------------------------------

  it('reconciles profitability to the ledger across time, expense, invoice, and payment', async () => {
    const customer = await createCustomer();
    const project = await createProject({
      customerId: customer.id,
      defaultRateMinor: '10000',
      budgetAmountMinor: '100000',
    });

    // 6 hours at 100.00 = 600.00 of billable time, plus a 400.00 expense rebilled with no markup.
    await approvedTime(project.id, '6.00');
    await billableExpense(project.id, '40000');

    const preview = await projects.listBillables(context.id, project.id);
    expect(preview.map((line) => line.lineTotalMinor).sort()).toEqual(['40000', '60000']);

    const invoice = await projects.generateInvoice(context, owner, project.id, {}, metadata);
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.totalMinor).toBe('100000');

    const receipt = await payments.record(
      context,
      owner,
      { contactId: customer.id, receivedDate: '2026-02-10', amountMinor: '100000' },
      metadata,
    );
    await payments.allocate(
      context,
      owner,
      receipt.id,
      { allocations: [{ invoiceId: invoice.id, amountMinor: '100000' }] },
      metadata,
    );
    const settled = await invoices.detail(context.id, invoice.id);
    expect(settled.status).toBe('PAID');
    expect(settled.balanceMinor).toBe('0');

    const profitability = await projects.profitability(context.id, project.id);

    // Revenue is the invoice; cost is the expense, which reached the project's dimension when the
    // expense posted rather than through a parallel sum over ProjectExpense rows. Margin is the
    // difference, and it is a real margin rather than the whole of revenue.
    expect(profitability.revenueMinor).toBe('100000');
    expect(profitability.costMinor).toBe('40000');
    expect(profitability.marginMinor).toBe('60000');
    expect(profitability.marginPercent).toBe('60');
    expect(profitability.billedHours).toBe('6.00');
    expect(profitability.unbilledHours).toBe('0.00');
    expect(profitability.unbilledTimeMinor).toBe('0');
    expect(profitability.unbilledExpenseMinor).toBe('0');

    // The figure profitability reports and the figure the ledger holds are the same rows, so they
    // reconcile by construction rather than by agreement between two aggregations.
    const ledgerRevenue = await dimensionedTotal(project.id, 'REVENUE');
    const ledgerCost = await dimensionedTotal(project.id, 'EXPENSE');
    expect(profitability.revenueMinor).toBe(ledgerRevenue.toString());
    expect(profitability.costMinor).toBe(ledgerCost.toString());

    // And every journal the scenario posted balances.
    const journals = await harness.prisma.journal.findMany({
      where: { organizationId: context.id, status: 'POSTED' },
      include: { lines: true },
    });
    expect(journals.length).toBeGreaterThan(0);
    for (const journal of journals) {
      const debits = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
      const credits = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
      expect(debits, `journal ${journal.id} is unbalanced`).toBe(credits);
    }
  });

  it('separates unbilled pipeline from posted ledger figures', async () => {
    const customer = await createCustomer();
    const project = await createProject({ customerId: customer.id, defaultRateMinor: '10000' });
    await approvedTime(project.id, '2.50');
    await billableExpense(project.id, '5000');

    const profitability = await projects.profitability(context.id, project.id);

    // Nothing is invoiced yet, so there is no revenue -- but the expense has already posted, so
    // the project is legitimately carrying a loss.
    expect(profitability.revenueMinor).toBe('0');
    expect(profitability.costMinor).toBe('5000');
    expect(profitability.marginMinor).toBe('-5000');
    expect(profitability.marginPercent).toBeNull();

    // The work still exists, and it shows up as pipeline rather than as revenue.
    expect(profitability.unbilledHours).toBe('2.50');
    expect(profitability.unbilledTimeMinor).toBe('25000');
    expect(profitability.unbilledExpenseMinor).toBe('5000');
  });

  // --- lifecycle -------------------------------------------------------------------------------

  it('refuses new time against a completed project and refuses to invoice a non-billable one', async () => {
    const customer = await createCustomer();
    const project = await createProject({ customerId: customer.id });
    await projects.changeStatus(context, owner, project.id, { status: 'COMPLETED' }, metadata);
    await expect(recordTime(project.id, '1.00')).rejects.toThrow(/record time/i);

    const internal = await createProject({
      name: 'Internal work',
      customerId: customer.id,
      billingMethod: 'NON_BILLABLE',
    });
    await expect(
      projects.generateInvoice(context, owner, internal.id, {}, metadata),
    ).rejects.toThrow(/non-billable/i);
  });

  it('refuses to invoice a project with no customer attached', async () => {
    const project = await createProject({ defaultRateMinor: '10000' });
    await approvedTime(project.id, '1.00');
    await expect(
      projects.generateInvoice(context, owner, project.id, {}, metadata),
    ).rejects.toThrow(/attach a customer/i);
  });

  // --- fixtures --------------------------------------------------------------------------------

  async function createCustomer() {
    return customers.create(context, owner, { displayName: 'Project Customer' }, metadata);
  }

  async function createProject(
    overrides: {
      name?: string;
      customerId?: string;
      billingMethod?: 'TIME_AND_MATERIALS' | 'FIXED_PRICE' | 'NON_BILLABLE';
      defaultRateMinor?: string;
      budgetAmountMinor?: string;
    } = {},
  ) {
    return projects.create(
      context,
      owner,
      {
        name: overrides.name ?? 'Ledger Migration',
        customerId: overrides.customerId,
        billingMethod: overrides.billingMethod,
        defaultRateMinor: overrides.defaultRateMinor,
        budgetAmountMinor: overrides.budgetAmountMinor,
      },
      metadata,
    );
  }

  async function recordTime(projectId: string, hours: string) {
    return projects.createTimeEntry(
      context,
      owner,
      { projectId, entryDate: '2026-02-02', hours },
      metadata,
    );
  }

  /** Records, submits, and approves time in one step, for the tests that start after approval. */
  async function approvedTime(projectId: string, hours: string) {
    const entry = await recordTime(projectId, hours);
    await projects.submitTime(context, owner, { timeEntryIds: [entry.id] }, metadata);
    await projects.approveTime(context, owner, { timeEntryIds: [entry.id] }, metadata);
    return entry;
  }

  async function postedExpense(amountMinor: string, projectId?: string) {
    const paidThrough = await ledger.accountBySystemKey(context.id, 'bank_default');
    const draft = await expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Project Supplier',
        expenseDate: '2026-02-04',
        paidThroughAccountId: paidThrough.id,
        amountMinor,
        projectId,
      },
      metadata,
    );
    return expenses.post(context, owner, draft.id, metadata);
  }

  async function billableExpense(projectId: string, amountMinor: string, markupPercent?: string) {
    const expense = await postedExpense(amountMinor, projectId);
    return projects.linkExpense(
      context,
      owner,
      projectId,
      { expenseId: expense.id, billable: true, markupPercent },
      metadata,
    );
  }

  /** Posted journal lines carrying this project's dimension, narrowed to one account type. */
  async function dimensionedLines(projectId: string, accountType: 'REVENUE' | 'EXPENSE') {
    return harness.prisma.journalLine.findMany({
      where: {
        organizationId: context.id,
        projectId,
        account: { organizationId: context.id, type: accountType },
        journal: { organizationId: context.id, status: { in: ['POSTED', 'REVERSED'] } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async function dimensionedTotal(projectId: string, accountType: 'REVENUE' | 'EXPENSE') {
    const lines = await dimensionedLines(projectId, accountType);
    return lines.reduce(
      (sum, line) =>
        accountType === 'REVENUE'
          ? sum + line.creditMinor - line.debitMinor
          : sum + line.debitMinor - line.creditMinor,
      0n,
    );
  }
});
