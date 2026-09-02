import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { DocumentNumberingService } from '../src/organizations/document-numbering.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { TaxService } from '../src/organizations/tax.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'accounting-invariants-test',
  userAgent: 'RetailBooks integration test',
};

describe('accounting, period, numbering, and tax invariants', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let tax: TaxService;
  let numbering: DocumentNumberingService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let cookie: string;
  let bankId: string;
  let revenueId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    tax = harness.app.get(TaxService);
    numbering = harness.app.get(DocumentNumberingService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'ledger-owner@example.test',
        displayName: 'Ledger Owner',
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
      { legalName: 'Invariant Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    bankId = (await ledger.accountBySystemKey(context.id, 'bank_default')).id;
    revenueId = (await ledger.accountBySystemKey(context.id, 'sales_revenue')).id;
    cookie = await sessionCookieFor(owner.id);
  });

  it('rejects an unbalanced journal at the HTTP boundary', async () => {
    await harness
      .http()
      .post(`${API}/organizations/${context.id}/journals`)
      .set('Cookie', cookie)
      .send({
        journalDate: '2026-08-24',
        currency: 'KES',
        description: 'Unbalanced entry',
        lines: [
          { accountId: bankId, debitMinor: '1000', creditMinor: '0' },
          { accountId: revenueId, debitMinor: '0', creditMinor: '999' },
        ],
      })
      .expect(400);
  });

  it('enforces the period state machine and rejects posting until the period is reopened', async () => {
    const draft = await createDraft('Period state entry');
    const august = await augustPeriod();

    await periods.close(context, owner, august.id, { note: 'Month end' }, metadata);
    await expect(
      periods.close(context, owner, august.id, { note: 'Duplicate close' }, metadata),
    ).rejects.toThrow('Cannot move a closed period to closed.');
    await post(draft.id, 'closed-period').expect(409);

    await periods.lock(context, owner, august.id, { note: 'Approved' }, metadata);
    await post(draft.id, 'locked-period').expect(409);
    await periods.unlock(context, owner, august.id, { note: 'Correction needed' }, metadata);
    await periods.reopen(context, owner, august.id, { note: 'Correction window' }, metadata);
    await post(draft.id, 'reopened-period').expect(200);
  });

  it('allocates gap-free unique numbers under genuinely parallel journal posting', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 10 }, (_, index) => createDraft(`Concurrent journal ${index + 1}`)),
    );
    const responses = await Promise.all(
      drafts.map((draft, index) => post(draft.id, `parallel-${index + 1}`).expect(200)),
    );
    const references = responses.map(
      (response) => (response.body as { data: { reference: string } }).data.reference,
    );
    expect(new Set(references)).toHaveLength(10);
    expect(references.map(referenceNumber).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('allocates gap-free unique numbers for a non-journal document type under parallel allocation', async () => {
    const allocations = await Promise.all(
      Array.from({ length: 10 }, () =>
        numbering.allocateDocumentNumberWithClient(harness.prisma, context.id, 'INVOICE'),
      ),
    );
    const sequenceNumbers = allocations.map((allocation) => allocation.sequenceNumber);
    expect(new Set(sequenceNumbers)).toHaveLength(10);
    expect(sequenceNumbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(allocations.map((allocation) => allocation.value))).toHaveLength(10);
    for (const allocation of allocations) {
      expect(allocation.documentType).toBe('INVOICE');
      expect(allocation.value.startsWith('INV-')).toBe(true);
    }
  });

  it('atomically replays concurrent requests sharing one idempotency key', async () => {
    const draft = await createDraft('Idempotent journal');
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => post(draft.id, 'same-key').expect(200)),
    );
    const results = responses.map(
      (response) => (response.body as { data: { id: string; reference: string } }).data,
    );

    expect(new Set(results.map((result) => result.id))).toHaveLength(1);
    expect(new Set(results.map((result) => result.reference))).toHaveLength(1);
    expect(
      await harness.prisma.ledgerIdempotencyKey.count({
        where: { organizationId: context.id, operation: 'JOURNAL_POST', key: 'same-key' },
      }),
    ).toBe(1);
    const sequence = await harness.prisma.documentNumberSequence.findFirstOrThrow({
      where: { organizationId: context.id },
    });
    expect(sequence.lastAllocatedNumber).toBe(1);
    expect(sequence.nextNumber).toBe(2);
  });

  it('allows only one competing post with different keys and does not burn a number', async () => {
    const draft = await createDraft('Competing journal');
    const responses = await Promise.all([
      post(draft.id, 'competitor-a'),
      post(draft.id, 'competitor-b'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);

    const sequence = await harness.prisma.documentNumberSequence.findFirstOrThrow({
      where: { organizationId: context.id },
    });
    expect(sequence.lastAllocatedNumber).toBe(1);
    expect(sequence.nextNumber).toBe(2);
    expect(
      await harness.prisma.ledgerIdempotencyKey.count({
        where: { organizationId: context.id, operation: 'JOURNAL_POST' },
      }),
    ).toBe(1);
  });

  it('keeps posted journals immutable and the trial balance equal', async () => {
    const draft = await createDraft('Immutable journal');
    await post(draft.id, 'immutable-post').expect(200);

    await expect(
      ledger.updateJournalDraft(context, draft.id, journalInput('Attempted edit')),
    ).rejects.toThrow('Posted journals cannot be edited.');
    await expect(ledger.deleteJournalDraft(context.id, draft.id)).rejects.toThrow(
      'Posted journals cannot be deleted.',
    );

    const trialBalance = await ledger.trialBalance(context.id, { asOf: '2026-08-31' });
    expect(trialBalance.totals.balanced).toBe(true);
    expect(trialBalance.totals.debitMinor).toBe(trialBalance.totals.creditMinor);
  });

  it('reverses exactly, preserves the frozen tax snapshot, links both journals, and stays immutable', async () => {
    const taxCode = await tax.createTaxCode(
      context,
      owner,
      {
        code: 'VAT16',
        name: 'VAT 16%',
        treatment: 'INCLUSIVE',
        recoverable: false,
      },
      metadata,
    );
    await tax.createRate(
      context,
      owner,
      taxCode.id,
      { ratePercent: '16', effectiveFrom: '2026-01-01' },
      metadata,
    );
    const original = await ledger.createJournalDraft(context, owner, {
      ...journalInput('Taxed sale'),
      lines: [
        {
          accountId: bankId,
          debitMinor: '11600',
          creditMinor: '0',
          taxCodeId: taxCode.id,
        },
        { accountId: revenueId, debitMinor: '0', creditMinor: '11600' },
      ],
    });
    const posted = await ledger.postJournal(context, owner, original.id, metadata, 'taxed-post');
    const taxedLine = required(
      posted.lines.find((line) => line.taxCodeId === taxCode.id),
      'Posted tax line is missing.',
    );
    expect(taxedLine).toMatchObject({
      taxCodeSnapshot: 'VAT16',
      taxTreatmentSnapshot: 'INCLUSIVE',
      taxRecoverableSnapshot: false,
      taxRatePercentSnapshot: '16',
      taxableAmountMinor: '10000',
      taxAmountMinor: '1600',
    });

    await harness.prisma.taxRate.updateMany({
      where: { taxCodeId: taxCode.id },
      data: { ratePercent: '20' },
    });
    const frozen = await ledger.getJournal(context.id, posted.id);
    expect(frozen.lines.find((line) => line.id === taxedLine.id)?.taxRatePercentSnapshot).toBe(
      '16',
    );

    const reversal = await ledger.reverseJournal(
      context,
      owner,
      posted.id,
      { journalDate: '2026-08-24' },
      metadata,
      'taxed-reversal',
    );
    const reversedTaxLine = required(
      reversal.lines.find((line) => line.accountId === taxedLine.accountId),
      'Reversal tax line is missing.',
    );
    expect(reversedTaxLine).toMatchObject({
      debitMinor: taxedLine.creditMinor,
      creditMinor: taxedLine.debitMinor,
      taxCodeId: taxedLine.taxCodeId,
      taxCodeSnapshot: taxedLine.taxCodeSnapshot,
      taxTreatmentSnapshot: taxedLine.taxTreatmentSnapshot,
      taxRecoverableSnapshot: taxedLine.taxRecoverableSnapshot,
      taxRatePercentSnapshot: taxedLine.taxRatePercentSnapshot,
      taxableAmountMinor: taxedLine.taxableAmountMinor,
      taxAmountMinor: taxedLine.taxAmountMinor,
    });
    expect(reversal.reversalOf?.id).toBe(posted.id);
    const originalAfter = await ledger.getJournal(context.id, posted.id);
    expect(originalAfter.status).toBe('REVERSED');
    expect(originalAfter.reversalJournal?.id).toBe(reversal.id);

    await expect(
      ledger.updateJournalDraft(context, reversal.id, journalInput('Attempted reversal edit')),
    ).rejects.toThrow('Posted journals cannot be edited.');
    await expect(ledger.deleteJournalDraft(context.id, reversal.id)).rejects.toThrow(
      'Posted journals cannot be deleted.',
    );
    const trialBalance = await ledger.trialBalance(context.id, { asOf: '2026-08-31' });
    expect(trialBalance.totals).toMatchObject({
      debitMinor: '0',
      creditMinor: '0',
      balanced: true,
    });
  });

  // The four ledger read paths below aggregate in PostgreSQL rather than reducing every posted
  // line in Node (Stage 4.1 / decision D2, docs/PERFORMANCE.md). These tests pin the behaviour
  // that a grouped query can silently change: accounts with no rows in the group, and the two
  // surfaces that must keep reporting the same number.

  it('agrees between the account list and the trial balance, including zero-movement accounts', async () => {
    await postDatedJournal('2026-07-15', '2500', 'aggregate-july');
    await postDatedJournal('2026-08-20', '1500', 'aggregate-august');

    const trialBalance = await ledger.trialBalance(context.id, { asOf: '2026-08-31' });
    const accounts = await ledger.listAccounts(context.id);

    // bank is a DEBIT account and revenue a CREDIT account, so both read positive on their own
    // normal side for the same 4000 of movement.
    expect(rowFor(trialBalance, bankId)).toMatchObject({ debitMinor: '4000', creditMinor: '0' });
    expect(rowFor(trialBalance, revenueId)).toMatchObject({ debitMinor: '0', creditMinor: '4000' });
    expect(balanceFor(accounts, bankId)).toBe('4000');
    expect(balanceFor(accounts, revenueId)).toBe('4000');

    // groupBy returns no row for an account that was never posted to. It must still appear in
    // both surfaces at zero rather than vanishing from the chart or the trial balance.
    const untouched = await ledger.accountBySystemKey(context.id, 'accounts_receivable');
    expect(rowFor(trialBalance, untouched.id)).toMatchObject({
      debitMinor: '0',
      creditMinor: '0',
    });
    expect(balanceFor(accounts, untouched.id)).toBe('0');
    expect(accounts).toHaveLength(trialBalance.rows.length);

    expect(trialBalance.totals).toMatchObject({
      debitMinor: '4000',
      creditMinor: '4000',
      balanced: true,
    });
  });

  it('honours the as-of date and excludes unposted journals from every aggregate', async () => {
    await postDatedJournal('2026-07-15', '2500', 'asof-july');
    await postDatedJournal('2026-08-20', '1500', 'asof-august');
    // A draft that is never posted must not reach any balance.
    await ledger.createJournalDraft(context, owner, {
      ...journalInput('Unposted draft'),
      journalDate: '2026-07-20',
    });

    const throughJuly = await ledger.trialBalance(context.id, { asOf: '2026-07-31' });
    expect(rowFor(throughJuly, bankId)).toMatchObject({ debitMinor: '2500' });

    const throughAugust = await ledger.trialBalance(context.id, { asOf: '2026-08-31' });
    expect(rowFor(throughAugust, bankId)).toMatchObject({ debitMinor: '4000' });
  });

  it('opens the account ledger at the balance carried in before the from date', async () => {
    await postDatedJournal('2026-07-15', '2500', 'opening-july');
    await postDatedJournal('2026-08-20', '1500', 'opening-august');

    const ranged = await ledger.accountLedger(context.id, bankId, { from: '2026-08-01' });
    expect(ranged.openingBalanceMinor).toBe('2500');
    expect(ranged.closingBalanceMinor).toBe('4000');
    expect(ranged.rows).toHaveLength(1);

    // With no `from`, everything is in range and the opening balance is zero by definition.
    const full = await ledger.accountLedger(context.id, bankId, {});
    expect(full.openingBalanceMinor).toBe('0');
    expect(full.closingBalanceMinor).toBe('4000');
  });

  async function postDatedJournal(
    journalDate: string,
    amountMinor: string,
    idempotencyKey: string,
  ) {
    const draft = await ledger.createJournalDraft(context, owner, {
      journalDate,
      currency: 'KES',
      description: `Aggregate probe ${journalDate}`,
      lines: [
        { accountId: bankId, debitMinor: amountMinor, creditMinor: '0' },
        { accountId: revenueId, debitMinor: '0', creditMinor: amountMinor },
      ],
    });
    return ledger.postJournal(context, owner, draft.id, metadata, idempotencyKey);
  }

  function rowFor(
    trialBalance: Awaited<ReturnType<LedgerService['trialBalance']>>,
    accountId: string,
  ) {
    return required(
      trialBalance.rows.find((row) => row.accountId === accountId),
      `Trial balance has no row for account ${accountId}.`,
    );
  }

  function balanceFor(
    accounts: Awaited<ReturnType<LedgerService['listAccounts']>>,
    accountId: string,
  ) {
    return required(
      accounts.find((account) => account.id === accountId),
      `Account list has no entry for account ${accountId}.`,
    ).balanceMinor;
  }

  async function createDraft(description: string) {
    return ledger.createJournalDraft(context, owner, journalInput(description));
  }

  function journalInput(description: string) {
    return {
      journalDate: '2026-08-24',
      currency: 'KES',
      description,
      lines: [
        { accountId: bankId, debitMinor: '1000', creditMinor: '0' },
        { accountId: revenueId, debitMinor: '0', creditMinor: '1000' },
      ],
    };
  }

  function post(journalId: string, idempotencyKey: string) {
    return harness
      .http()
      .post(`${API}/organizations/${context.id}/journals/${journalId}/post`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', idempotencyKey);
  }

  async function augustPeriod() {
    return harness.prisma.fiscalPeriod.findFirstOrThrow({
      where: {
        organizationId: context.id,
        startsOn: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
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

function referenceNumber(reference: string): number {
  const match = reference.match(/(\d+)$/);
  if (!match) throw new Error(`Reference ${reference} has no numeric suffix.`);
  return Number(match[1]);
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
