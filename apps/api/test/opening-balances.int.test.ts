import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { OpeningBalancesService } from '../src/organizations/opening-balances.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'opening-balances-test',
  userAgent: 'RetailBooks integration test',
};

describe('opening balances wizard against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let openingBalances: OpeningBalancesService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    openingBalances = harness.app.get(OpeningBalancesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'opening-balances-owner@example.test',
        displayName: 'Opening Balances Owner',
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
        legalName: 'Opening Balance Books Ltd',
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

  async function accountBySystemKey(systemKey: string) {
    return harness.prisma.ledgerAccount.findFirstOrThrow({
      where: { organizationId: context.id, systemKey },
    });
  }

  async function makeParty(displayName: string) {
    return harness.prisma.contact.create({
      data: { organizationId: context.id, displayName, currency: 'KES' },
    });
  }

  async function draftBatch() {
    const bank = await accountBySystemKey('bank_default');
    const retainedEarnings = await accountBySystemKey('retained_earnings');
    const equipment = await harness.prisma.ledgerAccount.findFirstOrThrow({
      where: { organizationId: context.id, code: '1500' },
    });
    const customer = await makeParty('Golden Customer Ltd');

    // Balanced batch:
    //   DR bank 50000 + DR AR (party) 20000 + DR equipment 30000
    //   CR retained earnings 100000
    return openingBalances.createBatch(
      context,
      owner,
      {
        asOfDate: '2026-01-01',
        description: 'Books start',
        lines: [
          { accountId: bank.id, debitMinor: '50000', creditMinor: '0', description: 'Bank' },
          { accountId: equipment.id, debitMinor: '30000', creditMinor: '0' },
          { accountId: retainedEarnings.id, debitMinor: '0', creditMinor: '100000' },
        ],
        partyLines: [{ side: 'RECEIVABLE', contactId: customer.id, amountMinor: '20000' }],
      },
      metadata,
    );
  }

  it('creates a draft with party detail and reports live balance totals', async () => {
    const batch = await draftBatch();
    expect(batch.status).toBe('DRAFT');
    expect(batch.totals.debitMinor).toBe('100000');
    expect(batch.totals.creditMinor).toBe('100000');
    expect(batch.totals.balanced).toBe(true);
    expect(batch.totals.receivableTotalMinor).toBe('20000');
  });

  it('rejects validation of an unbalanced batch and finalize of an unvalidated one', async () => {
    const bank = await accountBySystemKey('bank_default');
    const retainedEarnings = await accountBySystemKey('retained_earnings');
    const unbalanced = await openingBalances.createBatch(
      context,
      owner,
      {
        asOfDate: '2026-01-01',
        lines: [
          { accountId: bank.id, debitMinor: '50000', creditMinor: '0' },
          { accountId: retainedEarnings.id, debitMinor: '0', creditMinor: '40000' },
        ],
      },
      metadata,
    );
    expect(unbalanced.totals.balanced).toBe(false);

    await expect(openingBalances.validate(context, owner, unbalanced.id, metadata)).rejects.toThrow(
      /does not balance/,
    );
    // The hard gate: an unbalanced batch can never be finalized.
    await expect(openingBalances.finalize(context, owner, unbalanced.id, metadata)).rejects.toThrow(
      /Validate the batch/,
    );
  });

  it('finalizes a validated balanced batch into one rule-posted journal with traceability', async () => {
    const batch = await draftBatch();
    await openingBalances.validate(context, owner, batch.id, metadata);
    const result = await openingBalances.finalize(context, owner, batch.id, metadata);

    const journal = await harness.prisma.journal.findUniqueOrThrow({
      where: { id: result.journalId },
      include: { lines: true },
    });
    expect(journal.sourceType).toBe('OPENING_BALANCE');
    expect(journal.sourceId).toBe(batch.id);
    expect(journal.postingRule).toBe('OPENING_BALANCE_FINALIZE@v1');
    expect(journal.status).toBe('POSTED');

    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n);
    expect(debitTotal).toBe(creditTotal);
    expect(debitTotal).toBe(100000n);

    // Party detail aggregated into the control account by construction.
    const arAccount = await accountBySystemKey('accounts_receivable');
    const arLine = journal.lines.find((line) => line.accountId === arAccount.id);
    expect(arLine?.debitMinor).toBe(20000n);
    expect(arLine?.description).toBe('Opening accounts receivable');

    const detail = await openingBalances.detail(context.id, batch.id);
    expect(detail.status).toBe('FINALIZED');
    expect(detail.journalId).toBe(result.journalId);
  });

  it('is idempotent per batch: finalizing twice posts exactly one journal', async () => {
    const batch = await draftBatch();
    await openingBalances.validate(context, owner, batch.id, metadata);
    const first = await openingBalances.finalize(context, owner, batch.id, metadata);
    const second = await openingBalances.finalize(context, owner, batch.id, metadata);

    expect(second.journalId).toBe(first.journalId);
    expect(await harness.prisma.journal.count({ where: { sourceId: batch.id } })).toBe(1);
  });

  it('rejects a manual account line against a control account during validation', async () => {
    const arAccount = await accountBySystemKey('accounts_receivable');
    const retainedEarnings = await accountBySystemKey('retained_earnings');
    const batch = await openingBalances.createBatch(
      context,
      owner,
      {
        asOfDate: '2026-01-01',
        lines: [
          { accountId: arAccount.id, debitMinor: '5000', creditMinor: '0' },
          { accountId: retainedEarnings.id, debitMinor: '0', creditMinor: '5000' },
        ],
      },
      metadata,
    );

    await expect(openingBalances.validate(context, owner, batch.id, metadata)).rejects.toThrow(
      /party-level balances for/i,
    );
  });

  it('voids a finalized batch only while accounts are untouched, reversing exactly', async () => {
    const batch = await draftBatch();
    await openingBalances.validate(context, owner, batch.id, metadata);
    const finalized = await openingBalances.finalize(context, owner, batch.id, metadata);

    const voided = await openingBalances.voidBatch(
      context,
      owner,
      batch.id,
      'wrong starting figures',
      metadata,
    );
    expect(voided.status).toBe('VOID');

    const reversal = await harness.prisma.journal.findFirstOrThrow({
      where: { reversalOfJournalId: finalized.journalId },
      include: { lines: true },
    });
    expect(reversal.status).toBe('POSTED');
    const debitTotal = reversal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    expect(debitTotal).toBe(100000n);
  });

  it('refuses to void once another posting has touched a guarded account after the as-of date', async () => {
    const batch = await draftBatch();
    await openingBalances.validate(context, owner, batch.id, metadata);
    await openingBalances.finalize(context, owner, batch.id, metadata);

    // Simulate later activity on a guarded account (the bank): a manual posted journal.
    const bank = await accountBySystemKey('bank_default');
    const revenue = await accountBySystemKey('sales_revenue');
    const manual = await harness.prisma.journal.create({
      data: {
        organizationId: context.id,
        status: 'POSTED',
        journalDate: new Date('2026-02-01T00:00:00.000Z'),
        currency: 'KES',
        description: 'Later activity',
        createdByUserId: owner.id,
        postedAt: new Date(),
        lines: {
          create: [
            {
              organizationId: context.id,
              accountId: bank.id,
              lineNumber: 1,
              debitMinor: 10n,
              creditMinor: 0n,
            },
            {
              organizationId: context.id,
              accountId: revenue.id,
              lineNumber: 2,
              debitMinor: 0n,
              creditMinor: 10n,
            },
          ],
        },
      },
    });
    void manual;

    await expect(
      openingBalances.voidBatch(context, owner, batch.id, undefined, metadata),
    ).rejects.toThrow(/other activity on or after its as-of date/);
  });
});
