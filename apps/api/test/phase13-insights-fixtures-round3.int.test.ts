import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { AuditEvidencePackService } from '../src/insights/audit-evidence-pack.service.js';
import { VarianceInsightService } from '../src/insights/variance-insight.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CategorizationSuggestionService } from '../src/purchases/categorization-suggestion.service.js';
import { DraftNoteService } from '../src/purchases/draft-note.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { VendorsService } from '../src/purchases/vendors.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'phase13-insights-fixtures-round3-test',
  userAgent: 'RetailBooks insights fixture test (round 3)',
};

/** The 5th of the month `monthsBack` months before now, as an ISO date string. JS's `Date`
 * normalizes an out-of-range month (including negative), so this works across a year boundary
 * without special-casing it. */
function monthDate(monthsBack: number, day = 5): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, day));
  return date.toISOString().slice(0, 10);
}

/**
 * Real-data correctness tests for the four 13E/13F-P2 services this branch's own summary claimed
 * were already covered but were not: `CategorizationSuggestionService`, `DraftNoteService`, and
 * `VarianceInsightService` (13E), and `AuditEvidencePackService` (13F-P2). Closes the gap the
 * doc's "all thirteen 13E/13F services" claim was wrong about -- nine were covered, not thirteen.
 */
describe('Phase 13E/13F-P2 adviser correctness against real posted activity (round 3)', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let vendors: VendorsService;
  let expenses: ExpensesService;
  let categorizationSuggestion: CategorizationSuggestionService;
  let draftNote: DraftNoteService;
  let varianceInsight: VarianceInsightService;
  let auditEvidencePack: AuditEvidencePackService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let cookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    vendors = harness.app.get(VendorsService);
    expenses = harness.app.get(ExpensesService);
    categorizationSuggestion = harness.app.get(CategorizationSuggestionService);
    draftNote = harness.app.get(DraftNoteService);
    varianceInsight = harness.app.get(VarianceInsightService);
    auditEvidencePack = harness.app.get(AuditEvidencePackService);
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'round3-owner@example.test',
        displayName: 'Round 3 Owner',
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
      { legalName: 'Round 3 Fixtures Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    // Windows relative to the real clock (this month, and up to 3 months back), so the fiscal
    // year has to actually cover "now" -- current-year Jan 1, matching the bigint regression
    // suite's approach for the same reason.
    const fiscalYearStart = `${new Date().getUTCFullYear()}-01-01`;
    await periods.generateFiscalYear(context, owner, { startsOn: fiscalYearStart }, metadata);

    const token = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId: owner.id,
        tokenHash: hashToken(token),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    cookie = `rb_session=${token}`;
  });

  async function postExpense(
    vendorId: string,
    categoryId: string,
    amountMinor: string,
    expenseDate: string,
  ) {
    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    const draft = await expenses.createDraft(
      context,
      owner,
      { payeeVendorId: vendorId, categoryId, expenseDate, paidThroughAccountId: bankAccount.id, amountMinor },
      metadata,
    );
    return expenses.post(context, owner, draft.id, metadata);
  }

  it('categorization suggestion: picks the vendor\'s most-used category by real occurrence count', async () => {
    const vendor = await vendors.create(context, owner, { displayName: 'Round 3 Vendor' }, metadata);
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const categoryA = await harness.prisma.expenseCategory.create({
      data: { organizationId: context.id, name: 'Category A', accountId: expenseAccount.id },
    });
    const categoryB = await harness.prisma.expenseCategory.create({
      data: { organizationId: context.id, name: 'Category B', accountId: expenseAccount.id },
    });

    // 2 posted expenses for category A, 1 for category B -- A should win.
    await postExpense(vendor.id, categoryA.id, '10000', monthDate(0, 1));
    await postExpense(vendor.id, categoryA.id, '20000', monthDate(0, 2));
    await postExpense(vendor.id, categoryB.id, '30000', monthDate(0, 3));

    const suggestion = await categorizationSuggestion.suggestForVendor(context.id, vendor.id);

    expect(suggestion).toMatchObject({
      categoryId: categoryA.id,
      categoryName: 'Category A',
      occurrences: 2,
      totalObserved: 3,
      reason: 'Used in 2 of the last 3 posted expenses from this vendor.',
    });

    // A second call returns the same, already-created suggestion rather than recomputing --
    // confirmed by getting an identical result, including the same suggestionId.
    const second = await categorizationSuggestion.suggestForVendor(context.id, vendor.id);
    expect(second?.suggestionId).toBe(suggestion?.suggestionId);
  });

  it('categorization suggestion: returns null for a vendor with no posted history', async () => {
    const vendor = await vendors.create(context, owner, { displayName: 'No History Vendor' }, metadata);
    await expect(categorizationSuggestion.suggestForVendor(context.id, vendor.id)).resolves.toBeNull();
  });

  it('draft note: renders the expense\'s own recorded facts verbatim, no invented detail', async () => {
    const vendor = await vendors.create(context, owner, { displayName: 'Draft Note Vendor' }, metadata);
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const category = await harness.prisma.expenseCategory.create({
      data: { organizationId: context.id, name: 'Draft Note Category', accountId: expenseAccount.id },
    });
    const posted = await postExpense(vendor.id, category.id, '123456', '2026-03-15');

    const draft = await draftNote.draftForExpense(context.id, posted.id);

    expect(draft.text).toBe(
      `${posted.currency} 1234.56 paid to Draft Note Vendor on 2026-03-15, recorded under Draft Note Category.`,
    );
    expect(draft.suggestionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('variance insight: flags a significant increase, a brand-new category, and skips an insignificant change', async () => {
    const vendor = await vendors.create(context, owner, { displayName: 'Variance Vendor' }, metadata);
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const increasing = await harness.prisma.expenseCategory.create({
      data: { organizationId: context.id, name: 'Increasing Category', accountId: expenseAccount.id },
    });
    const brandNew = await harness.prisma.expenseCategory.create({
      data: { organizationId: context.id, name: 'Brand New Category', accountId: expenseAccount.id },
    });
    const stable = await harness.prisma.expenseCategory.create({
      data: { organizationId: context.id, name: 'Stable Category', accountId: expenseAccount.id },
    });

    // Baseline: 10000 minor/month for 3 months for both "increasing" and "stable".
    for (let monthsBack = 1; monthsBack <= 3; monthsBack += 1) {
      await postExpense(vendor.id, increasing.id, '10000', monthDate(monthsBack));
      await postExpense(vendor.id, stable.id, '10000', monthDate(monthsBack));
    }
    // This month: "increasing" doubles (100% increase, well over the 30% significance floor);
    // "stable" only rises 10% (under the floor, must not appear); "brand new" has no baseline at
    // all but real current spend.
    await postExpense(vendor.id, increasing.id, '20000', monthDate(0));
    await postExpense(vendor.id, stable.id, '11000', monthDate(0));
    await postExpense(vendor.id, brandNew.id, '5000', monthDate(0));

    const insights = await varianceInsight.detect(context.id);
    const byCategory = new Map(insights.map((insight) => [insight.categoryId, insight]));

    expect(byCategory.get(stable.id)).toBeUndefined();
    expect(byCategory.get(increasing.id)).toMatchObject({
      currentMinor: '20000',
      baselineMinor: '10000',
      variancePercent: 100,
      direction: 'increase',
    });
    expect(byCategory.get(brandNew.id)).toMatchObject({
      currentMinor: '5000',
      baselineMinor: '0',
      variancePercent: null,
      direction: 'new',
    });
    // Sorted by absolute variance magnitude descending -- the "new" category (treated as 100 for
    // sorting per the service's own fallback) and the 100%-increase category are the only two
    // results, in some order; "stable" must be absent from both.
    expect(insights).toHaveLength(2);
  });

  it('audit evidence pack: assembles real audit events, attachments, and a reversal journal for a voided expense', async () => {
    const vendor = await vendors.create(context, owner, { displayName: 'Evidence Pack Vendor' }, metadata);
    const expenseAccount = await ledger.accountBySystemKey(context.id, 'general_expense');
    const category = await harness.prisma.expenseCategory.create({
      data: { organizationId: context.id, name: 'Evidence Pack Category', accountId: expenseAccount.id },
    });
    const posted = await postExpense(vendor.id, category.id, '75000', '2026-03-20');

    await harness
      .http()
      .post(`${API}/organizations/${context.id}/expenses/${posted.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('Evidence pack fixture receipt.', 'utf8'), {
        filename: 'receipt.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    await expenses.voidExpense(context, owner, posted.id, metadata);

    const pack = await auditEvidencePack.assemble(context.id, 'EXPENSE', posted.id);

    expect(pack.attachments).toHaveLength(1);
    expect(pack.attachments[0]?.filename).toBe('receipt.txt');
    // Voiding reverses the original journal, marking it REVERSED (not left as POSTED).
    expect(pack.journal).toMatchObject({ id: posted.journalId, status: 'REVERSED' });
    expect(pack.reversalJournal).not.toBeNull();
    expect(pack.auditEvents.length).toBeGreaterThan(0);
    expect(pack.auditEvents.map((event) => event.eventKey)).toEqual(
      expect.arrayContaining(['purchases.expense_posted', 'purchases.expense_voided']),
    );
  });

  it('audit evidence pack: fails closed with not-found when an entity has no evidence at all', async () => {
    await expect(
      auditEvidencePack.assemble(context.id, 'EXPENSE', '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
