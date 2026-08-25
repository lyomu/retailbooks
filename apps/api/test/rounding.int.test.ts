import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { RoundingService } from '../src/organizations/rounding.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'rounding-test',
  userAgent: 'RetailBooks integration test',
};

describe('rounding policy against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let rounding: RoundingService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    rounding = harness.app.get(RoundingService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'rounding-owner@example.test',
        displayName: 'Rounding Owner',
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
      { legalName: 'Rounding Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  });

  function organizationId() {
    return context.id;
  }

  it('posts a balanced adjustment to the rounding account when HALF_UP is configured', async () => {
    // Configure HALF_UP cash rounding to the nearest 50 minor units via the ACCOUNTING section.
    await organizations.updateSection(
      context,
      owner,
      { section: 'ACCOUNTING', roundingMode: 'HALF_UP', roundingUnitMinor: 50 },
      metadata,
    );

    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    // A computed payable of 123 minor rounds down to 100 -> payer owes 23 less.
    const result = await rounding.postAdjustment(
      context,
      owner,
      {
        journalDate: new Date('2026-02-01T00:00:00.000Z'),
        currency: 'KES',
        adjustAccountId: bank.id,
        amountMinor: 123n,
      },
      metadata,
    );
    expect(result.deltaMinor).toBe('-23');

    const journal = await harness.prisma.journal.findUniqueOrThrow({
      where: { id: result.journalId },
      include: { lines: true },
    });
    expect(journal.sourceType).toBe('ROUNDING');
    expect(journal.postingRule).toBe('ROUNDING_ADJUSTMENT@v1');
    expect(journal.lines).toHaveLength(2);
    const debitTotal = journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n);
    expect(debitTotal).toBe(23n);

    const roundingAccount = await ledger.accountBySystemKey(context.id, 'rounding');
    const roundingLine = journal.lines.find((line) => line.accountId === roundingAccount.id);
    expect(roundingLine?.debitMinor).toBe(23n);
    const bankLine = journal.lines.find((line) => line.accountId === bank.id);
    expect(bankLine?.creditMinor).toBe(23n);
  });

  it('rejects adjustments when no rounding policy is configured (NONE preserves behavior)', async () => {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    await expect(
      rounding.postAdjustment(
        context,
        owner,
        {
          journalDate: new Date('2026-02-01T00:00:00.000Z'),
          currency: 'KES',
          adjustAccountId: bank.id,
          amountMinor: 123n,
        },
        metadata,
      ),
    ).rejects.toThrow(/no rounding policy/i);

    expect(
      await harness.prisma.journal.count({ where: { organizationId: organizationId() } }),
    ).toBe(0);
  });
});
