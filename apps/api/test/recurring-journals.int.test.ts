import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { RecurringJournalsService } from '../src/organizations/recurring-journals.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'recurring-journals-test',
  userAgent: 'RetailBooks integration test',
};

describe('recurring journal generation against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let recurringJournals: RecurringJournalsService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    recurringJournals = harness.app.get(RecurringJournalsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'recurring-journals-owner@example.test',
        displayName: 'Recurring Journals Owner',
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
        legalName: 'Recurring Journal Books Ltd',
        businessType: 'LIMITED_COMPANY',
        countryCode: 'KE',
      },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  });

  async function templateInput(overrides: Record<string, unknown> = {}) {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const rentAccount = await harness.prisma.ledgerAccount.findFirstOrThrow({
      where: { organizationId: context.id, code: '5010' }, // Rent
    });
    return {
      name: 'Office rent accrual',
      cadence: 'MONTHLY' as const,
      startDate: '2026-01-15',
      lines: [
        { accountId: rentAccount.id, debitMinor: '2500', creditMinor: '0', description: 'Rent' },
        { accountId: bank.id, debitMinor: '0', creditMinor: '2500', description: 'Bank' },
      ],
      ...overrides,
    };
  }

  it('generates exactly one posted journal for a due occurrence and advances nextRunDate', async () => {
    const template = await recurringJournals.createTemplate(
      context,
      owner,
      await templateInput(),
      metadata,
    );
    expect(template.nextRunDate).toBe('2026-01-15');

    const results = await recurringJournals.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);
    const journalId = results[0]!.journalId!;
    const journal = await harness.prisma.journal.findUniqueOrThrow({
      where: { id: journalId },
      include: { lines: true },
    });
    expect(journal.status).toBe('POSTED');
    expect(journal.sourceType).toBe('RECURRING_JOURNAL');
    expect(journal.sourceId).toBe(template.id);
    expect(journal.postingRule).toBe('RECURRING_JOURNAL_GENERATE@v1');

    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    expect(debitTotal).toBe(2500n);

    const updated = await recurringJournals.detail(context.id, template.id);
    expect(updated.nextRunDate).toBe('2026-02-15');
  });

  it('rejects an unbalanced template at creation', async () => {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const revenue = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    await expect(
      recurringJournals.createTemplate(
        context,
        owner,
        await templateInput({
          lines: [
            { accountId: bank.id, debitMinor: '100', creditMinor: '0' },
            { accountId: revenue.id, debitMinor: '0', creditMinor: '99' },
          ],
        }),
        metadata,
      ),
    ).rejects.toThrow(/must balance/);
  });

  it('skips a template whose nextRunDate has not arrived yet', async () => {
    await recurringJournals.createTemplate(
      context,
      owner,
      await templateInput({ startDate: '2099-01-15' }),
      metadata,
    );
    const results = await recurringJournals.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(0);
    expect(await harness.prisma.journal.count({ where: { organizationId: context.id } })).toBe(0);
  });

  it('deactivates a template whose next occurrence would fall past endDate', async () => {
    const template = await recurringJournals.createTemplate(
      context,
      owner,
      await templateInput({ cadence: 'WEEKLY', startDate: '2026-01-01', endDate: '2026-01-05' }),
      metadata,
    );
    const results = await recurringJournals.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);

    const updated = await recurringJournals.detail(context.id, template.id);
    expect(updated.active).toBe(false);
    expect(await recurringJournals.runDueTemplates(context, owner, metadata)).toHaveLength(0);
  });

  it('concurrent double-trigger produces exactly one journal per occurrence', async () => {
    const template = await recurringJournals.createTemplate(
      context,
      owner,
      await templateInput(),
      metadata,
    );

    const [first, second] = await Promise.all([
      recurringJournals.runDueTemplates(context, owner, metadata),
      recurringJournals.runDueTemplates(context, owner, metadata),
    ]);

    const generatedIds = [...first, ...second]
      .filter((result) => result.journalId)
      .map((result) => result.journalId!);
    expect(generatedIds).toHaveLength(1);

    expect(await harness.prisma.journal.count({ where: { sourceId: template.id } })).toBe(1);
    const claimCount = await harness.prisma.ledgerIdempotencyKey.count({
      where: {
        organizationId: context.id,
        operation: { in: ['RECURRING_JOURNAL_CLAIM', 'RECURRING_JOURNAL_GENERATE'] },
      },
    });
    // Exactly one occurrence claim plus exactly one posting idempotency record.
    expect(claimCount).toBe(2);
  });

  it('updates, deactivates, and reactivates a template', async () => {
    const template = await recurringJournals.createTemplate(
      context,
      owner,
      await templateInput(),
      metadata,
    );
    const updated = await recurringJournals.updateTemplate(
      context,
      owner,
      template.id,
      { name: 'Rent (revised)', memo: 'Board-approved' },
      metadata,
    );
    expect(updated.name).toBe('Rent (revised)');
    expect(updated.memo).toBe('Board-approved');

    const deactivated = await recurringJournals.deactivate(context, owner, template.id, metadata);
    expect(deactivated.active).toBe(false);
    const reactivated = await recurringJournals.reactivate(context, owner, template.id, metadata);
    expect(reactivated.active).toBe(true);
  });
});
