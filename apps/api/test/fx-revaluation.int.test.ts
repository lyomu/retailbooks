import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

import type { PublicUser } from '../src/auth/auth.service.js';
import { CurrencyService } from '../src/organizations/currency.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { FxRevaluationService } from '../src/organizations/fx-revaluation.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'fx-revaluation-test',
  userAgent: 'RetailBooks integration test',
};

describe('FX revaluation batch against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let currencies: CurrencyService;
  let fxRevaluation: FxRevaluationService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    currencies = harness.app.get(CurrencyService);
    fxRevaluation = harness.app.get(FxRevaluationService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'fx-reval-owner@example.test',
        displayName: 'FX Reval Owner',
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
      { legalName: 'FX Reval Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  });

  /**
   * Builds a USD receivable position of 10000 foreign minor units (100.00 USD) booked at 1 USD =
   * 10 KES -> 100000 KES debit on the AR control account.
   */
  async function seedUsdReceivable() {
    const arAccount = await ledger.accountBySystemKey(context.id, 'accounts_receivable');
    const revenueAccount = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    await currencies.enable(context, owner, { currencyCode: 'USD' }, metadata);
    await currencies.upsertRate(
      context,
      owner,
      { quoteCurrency: 'USD', rateDate: '2026-01-05', rate: '10' },
      metadata,
    );

    await harness.prisma.journal.create({
      data: {
        organizationId: context.id,
        status: 'POSTED',
        journalDate: new Date('2026-01-06T00:00:00.000Z'),
        currency: 'USD',
        exchangeRate: new Prisma.Decimal('10'),
        description: 'Foreign invoice',
        createdByUserId: owner.id,
        postedAt: new Date(),
        lines: {
          create: [
            {
              organizationId: context.id,
              accountId: arAccount.id,
              lineNumber: 1,
              debitMinor: 100000n,
              creditMinor: 0n,
              foreignAmountMinor: 10000n,
              exchangeRate: new Prisma.Decimal('10'),
            },
            {
              organizationId: context.id,
              accountId: revenueAccount.id,
              lineNumber: 2,
              debitMinor: 0n,
              creditMinor: 100000n,
              foreignAmountMinor: 10000n,
              exchangeRate: new Prisma.Decimal('10'),
            },
          ],
        },
      },
    });
  }

  it('restates a foreign monetary position at a shifted rate and posts only the delta', async () => {
    await seedUsdReceivable();

    // Reporting rate as of the run date drops to 9 KES per USD: the 100.00 USD receivable is now
    // worth 90000 KES vs the 100000 KES booked -> a 10000 KES FX loss on AR.
    await currencies.upsertRate(
      context,
      owner,
      { quoteCurrency: 'USD', rateDate: '2026-02-01', rate: '9' },
      metadata,
    );

    const result = await fxRevaluation.run(context, owner, '2026-02-05', metadata);
    expect(result.adjustedAccounts).toBe(1);
    expect(result.lossMinor).toBe('10000');
    expect(result.gainMinor).toBe('0');

    const journal = await harness.prisma.journal.findUniqueOrThrow({
      where: { id: result.journalId },
      include: { lines: true },
    });
    expect(journal.sourceType).toBe('FX_REVALUATION');
    expect(journal.postingRule).toBe('FX_REVALUATION_RUN@v1');

    const arAccount = await ledger.accountBySystemKey(context.id, 'accounts_receivable');
    const lossAccount = await ledger.accountBySystemKey(context.id, 'fx_loss');
    const arLine = journal.lines.find((line) => line.accountId === arAccount.id);
    const lossLine = journal.lines.find((line) => line.accountId === lossAccount.id);
    // The receivable weakened: credit AR, debit fx_loss.
    expect(arLine?.creditMinor).toBe(10000n);
    expect(lossLine?.debitMinor).toBe(10000n);
  });

  it('rejects a second revaluation for the same as-of date', async () => {
    await seedUsdReceivable();
    await currencies.upsertRate(
      context,
      owner,
      { quoteCurrency: 'USD', rateDate: '2026-02-01', rate: '9' },
      metadata,
    );
    await fxRevaluation.run(context, owner, '2026-02-05', metadata);
    await expect(fxRevaluation.run(context, owner, '2026-02-05', metadata)).rejects.toThrow(
      /already exists/,
    );
  });

  it('reports nothing to do when no foreign monetary positions exist', async () => {
    await expect(fxRevaluation.run(context, owner, '2026-02-05', metadata)).rejects.toThrow(
      /No open foreign-currency monetary positions/,
    );
  });
});
