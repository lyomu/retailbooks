import { OnboardingStep, OrganizationStatus, UserStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { CurrencyService } from '../src/organizations/currency.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = { ipHash: 'test-ip', userAgent: 'vitest' };

describe('multi-currency and FX against a real database', () => {
  let harness: TestHarness;
  let currencies: CurrencyService;
  let ledger: LedgerService;
  let organizations: OrganizationService;
  let user: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    currencies = harness.app.get(CurrencyService);
    ledger = harness.app.get(LedgerService);
    organizations = harness.app.get(OrganizationService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const createdUser = await harness.prisma.user.create({
      data: {
        email: 'fx-owner@example.com',
        displayName: 'FX Owner',
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
      },
    });
    const organization = await harness.prisma.organization.create({
      data: {
        legalName: 'FX Demo Ltd',
        slug: 'fx-demo-ltd',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        status: OrganizationStatus.ACTIVE,
        onboardingStep: OnboardingStep.COMPLETE,
        createdByUserId: createdUser.id,
        preferences: {
          create: {
            chartTemplate: 'general-business',
            countryPackCode: 'KE',
            countryPackVersion: '2026.1-draft',
          },
        },
      },
    });
    await harness.prisma.$transaction((tx) =>
      currencies.ensureOrganizationBaseCurrency(tx, organization.id, 'KES'),
    );
    await ledger.ensureStarterChart(organization.id, 'general-business');
    await harness.prisma.fiscalYear.create({
      data: {
        organizationId: organization.id,
        label: 'FY 2026',
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-31T00:00:00.000Z'),
        periods: {
          create: {
            organizationId: organization.id,
            code: '2026-08',
            name: 'August 2026',
            startsOn: new Date('2026-08-01T00:00:00.000Z'),
            endsOn: new Date('2026-08-31T00:00:00.000Z'),
          },
        },
      },
    });

    user = {
      id: createdUser.id,
      email: createdUser.email,
      displayName: createdUser.displayName,
      emailVerified: true,
      status: createdUser.status,
    };
    context = {
      id: organization.id,
      legalName: organization.legalName,
      slug: organization.slug,
      status: organization.status,
      onboardingStep: organization.onboardingStep,
      role: { id: randomUUID(), key: 'OWNER', name: 'Owner', isOwnerRole: true },
      permissions: new Set(),
    };
  });

  it('enables an organization currency and stores an effective-dated rate', async () => {
    await currencies.enable(context, user, { currencyCode: 'USD' }, metadata);
    const settings = await currencies.upsertRate(
      context,
      user,
      { quoteCurrency: 'USD', rate: '129.5', rateDate: '2026-08-20', source: 'MANUAL' },
      metadata,
    );

    expect(settings.baseCurrency).toBe('KES');
    expect(settings.currencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'KES', isBase: true, enabled: true }),
        expect.objectContaining({ code: 'USD', isBase: false, enabled: true }),
      ]),
    );
    expect(settings.exchangeRates[0]).toMatchObject({
      baseCurrency: 'KES',
      quoteCurrency: 'USD',
      rate: '129.5',
      rateDate: '2026-08-20',
    });
  });

  it('snapshots the applied rate, converts with BigInt math, and posts an FX loss line', async () => {
    await currencies.enable(context, user, { currencyCode: 'USD' }, metadata);
    await currencies.upsertRate(
      context,
      user,
      { quoteCurrency: 'USD', rate: '129.5', rateDate: '2026-08-20' },
      metadata,
    );

    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const receivable = await ledger.accountBySystemKey(context.id, 'accounts_receivable');
    const loss = await ledger.accountBySystemKey(context.id, 'fx_loss');
    const draft = await ledger.createJournalDraft(context, user, {
      journalDate: '2026-08-24',
      currency: 'USD',
      description: 'Settle a USD receivable',
      lines: [
        {
          accountId: bank.id,
          debitMinor: '1',
          creditMinor: '0',
          foreignAmountMinor: '100000',
        },
        {
          accountId: receivable.id,
          debitMinor: '0',
          creditMinor: '13000000',
        },
      ],
    });

    const posted = await ledger.postJournal(context, user, draft.id, metadata, 'fx-post-1');

    expect(posted.status).toBe('POSTED');
    expect(posted.exchangeRate).toBe('129.5');
    expect(posted.totals).toMatchObject({
      debitMinor: '13000000',
      creditMinor: '13000000',
      balanced: true,
    });
    expect(posted.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: bank.id,
          debitMinor: '12950000',
          foreignAmountMinor: '100000',
          exchangeRate: '129.5',
        }),
        expect.objectContaining({
          accountId: loss.id,
          debitMinor: '50000',
          creditMinor: '0',
          exchangeRate: '129.5',
        }),
      ]),
    );
  });

  it('blocks a base-currency change after a journal has posted', async () => {
    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    const revenue = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const draft = await ledger.createJournalDraft(context, user, {
      journalDate: '2026-08-24',
      currency: 'KES',
      description: 'Base-currency activity',
      lines: [
        { accountId: bank.id, debitMinor: '1000', creditMinor: '0' },
        { accountId: revenue.id, debitMinor: '0', creditMinor: '1000' },
      ],
    });
    await ledger.postJournal(context, user, draft.id, metadata, 'base-post-1');

    await expect(
      organizations.updateSection(
        context,
        user,
        { section: 'JURISDICTION', baseCurrency: 'USD' },
        metadata,
      ),
    ).rejects.toThrow('Base currency cannot change after accounting activity is posted.');
  });
});
