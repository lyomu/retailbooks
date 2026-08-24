import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SYSTEM_ACCOUNT_KEYS } from '../src/organizations/ledger-starter-chart.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

describe('system accounts against a real database', () => {
  let harness: TestHarness;
  let ledger: LedgerService;
  let organizationId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    ledger = harness.app.get(LedgerService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();

    const user = await harness.prisma.user.create({
      data: { email: 'owner@example.com', displayName: 'Owner' },
    });
    const organization = await harness.prisma.organization.create({
      data: {
        legalName: 'Demo Ltd',
        slug: 'demo-ltd',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        createdByUserId: user.id,
        preferences: {
          create: {
            chartTemplate: 'general-business',
            countryPackCode: 'KE',
            countryPackVersion: '1.0.0',
          },
        },
      },
    });
    organizationId = organization.id;
  });

  it('binds every system key when the starter chart is seeded', async () => {
    await ledger.ensureStarterChart(organizationId, 'general-business');

    const bound = await harness.prisma.ledgerAccount.findMany({
      where: { organizationId, systemKey: { not: null } },
      select: { systemKey: true },
    });

    expect(bound.map((a) => a.systemKey).sort()).toEqual([...SYSTEM_ACCOUNT_KEYS].sort());
  });

  it('resolves each system key to exactly one account', async () => {
    for (const key of SYSTEM_ACCOUNT_KEYS) {
      const account = await ledger.accountBySystemKey(organizationId, key);
      expect(account.organizationId).toBe(organizationId);
      expect(account.systemKey).toBe(key);
    }
  });

  it('seeds the chart on demand when resolving a key for a fresh organization', async () => {
    expect(await harness.prisma.ledgerAccount.count({ where: { organizationId } })).toBe(0);

    const account = await ledger.accountBySystemKey(organizationId, 'accounts_receivable');

    expect(account.code).toBe('1100');
    expect(account.isControl).toBe(true);
  });

  it('enforces one account per system key at the database level', async () => {
    await ledger.ensureStarterChart(organizationId, 'general-business');

    await expect(
      harness.prisma.ledgerAccount.create({
        data: {
          organizationId,
          code: '9999',
          name: 'Duplicate receivables',
          type: 'ASSET',
          normalBalance: 'DEBIT',
          systemKey: 'accounts_receivable',
        },
      }),
    ).rejects.toThrow();
  });

  it('scopes system keys per organization rather than globally', async () => {
    await ledger.ensureStarterChart(organizationId, 'general-business');

    const otherUser = await harness.prisma.user.create({
      data: { email: 'second@example.com', displayName: 'Second' },
    });
    const other = await harness.prisma.organization.create({
      data: {
        legalName: 'Second Ltd',
        slug: 'second-ltd',
        countryCode: 'KE',
        baseCurrency: 'KES',
        timeZone: 'Africa/Nairobi',
        locale: 'en-KE',
        createdByUserId: otherUser.id,
        preferences: {
          create: {
            chartTemplate: 'general-business',
            countryPackCode: 'KE',
            countryPackVersion: '1.0.0',
          },
        },
      },
    });

    await expect(ledger.ensureStarterChart(other.id, 'general-business')).resolves.not.toThrow();

    const mine = await ledger.accountBySystemKey(organizationId, 'tax_payable');
    const theirs = await ledger.accountBySystemKey(other.id, 'tax_payable');
    expect(mine.id).not.toBe(theirs.id);
  });
});
