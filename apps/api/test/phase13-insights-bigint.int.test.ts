import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { CashFlowScenarioService } from '../src/insights/cash-flow-scenario.service.js';
import { ProjectMarginAdviserService } from '../src/insights/project-margin-adviser.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'phase13-insights-bigint-test',
  userAgent: 'RetailBooks bigint regression test',
};

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Regression coverage for a real bug found through browser verification against seeded demo data:
 * `SUM()` over a bigint expression returns PostgreSQL `numeric`, not `bigint`. Without an explicit
 * `::bigint` cast, Prisma returns something that isn't a real bigint at runtime (a Decimal), and
 * mixing it into bigint arithmetic throws `TypeError: Cannot mix BigInt and other types`. Every
 * earlier automated test for these two services used a freshly-created, empty organization, where
 * the aggregate always returns SQL NULL -- the bug only reproduces with a non-null sum, i.e. real
 * posted activity within the service's own lookback window. This file exists specifically to keep
 * that from regressing silently again; both fixtures below post activity within the last 30 days so
 * `marginByProject`'s current-window query (the one that threw) is the one actually exercised, not
 * skipped by a date-window miss.
 */
describe('Phase 13F/G insights against real posted activity (bigint regression)', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let cashFlow: CashFlowScenarioService;
  let projectMargins: ProjectMarginAdviserService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    cashFlow = harness.app.get(CashFlowScenarioService);
    projectMargins = harness.app.get(ProjectMarginAdviserService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'bigint-owner@example.test',
        displayName: 'Bigint Owner',
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
      { legalName: 'Bigint Regression Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    // Both services window relative to the real clock, not a fixed fixture date, so the generated
    // fiscal year has to actually cover "now" -- current-year Jan 1, matching the fixture dates
    // below (all within the last 10 days of whenever this test actually runs).
    const fiscalYearStart = `${new Date().getUTCFullYear()}-01-01`;
    await periods.generateFiscalYear(context, owner, { startsOn: fiscalYearStart }, metadata);
  });

  it('computes an opening cash position from real posted bank activity without throwing', async () => {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const revenue = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const journalDraft = await ledger.createJournalDraft(context, owner, {
      journalDate: daysAgo(10),
      currency: 'KES',
      description: 'Cash-flow bigint regression fixture',
      lines: [
        { accountId: bank.id, debitMinor: '145600', creditMinor: '0' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '145600' },
      ],
    });
    await ledger.postJournal(context, owner, journalDraft.id, metadata, 'cash-flow-bigint-fixture');

    const scenario = await cashFlow.project(context.id);
    expect(scenario.openingBalanceMinor).toBe('145600');
    expect(scenario.onTime).toHaveLength(12);
  });

  it('advises on a project with real posted revenue and expense without throwing', async () => {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const revenue = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const expense = await ledger.accountBySystemKey(context.id, 'general_expense');

    const project = await harness.prisma.project.create({
      data: {
        organizationId: context.id,
        name: 'Bigint Regression Project',
        currency: 'KES',
        createdByUserId: owner.id,
      },
    });

    // JournalLineDto has no client-settable projectId (manual entry can't tag a project); the
    // adviser's own SQL reads journal_lines.project_id directly, so that's the fixture shape that
    // actually matters here -- set it straight on the posted rows rather than routing through a
    // full project-expense/time-entry posting flow this test doesn't otherwise need.
    const revenueDraft = await ledger.createJournalDraft(context, owner, {
      journalDate: daysAgo(5),
      currency: 'KES',
      description: 'Project revenue fixture',
      lines: [
        { accountId: bank.id, debitMinor: '100000', creditMinor: '0' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '100000' },
      ],
    });
    await ledger.postJournal(context, owner, revenueDraft.id, metadata, 'project-revenue-fixture');

    const expenseDraft = await ledger.createJournalDraft(context, owner, {
      journalDate: daysAgo(3),
      currency: 'KES',
      description: 'Project expense fixture',
      lines: [
        { accountId: expense.id, debitMinor: '30000', creditMinor: '0' },
        { accountId: bank.id, debitMinor: '0', creditMinor: '30000' },
      ],
    });
    await ledger.postJournal(context, owner, expenseDraft.id, metadata, 'project-expense-fixture');

    await harness.prisma.journalLine.updateMany({
      where: {
        organizationId: context.id,
        journalId: { in: [revenueDraft.id, expenseDraft.id] },
        accountId: { in: [revenue.id, expense.id] },
      },
      data: { projectId: project.id },
    });

    // marginByProject() -- the query that threw before the ::bigint fix -- runs unconditionally for
    // every project with posted activity in the window, regardless of whether it ends up in the
    // final advise() output (that output is filtered to projects with *unbilled* time/expense,
    // which this fixture deliberately has none of). The regression is that this call must not
    // throw; it is not about what it returns.
    await expect(projectMargins.advise(context.id)).resolves.toEqual([]);
  });
});
