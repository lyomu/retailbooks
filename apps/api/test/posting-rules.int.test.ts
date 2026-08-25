import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { accountIdRef, systemKeyRef, type PostingRule } from '../src/posting-rules/posting-rule.js';
import { PostingRulesService } from '../src/posting-rules/posting-rules.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'posting-rules-test',
  userAgent: 'RetailBooks integration test',
};

interface SimpleSource extends Record<string, unknown> {
  sourceId: string;
  journalDate: Date;
  currency: string;
  amountMinor: bigint;
  bankAccountId: string;
}

const balancedRule: PostingRule<SimpleSource> = {
  event: 'RULE_TEST_EVENT',
  sourceType: 'RULE_TEST',
  version: 3,
  describe: (source) => `Rule test posting ${source.sourceId}`,
  lines: (source) => [
    {
      account: accountIdRef(source.bankAccountId),
      description: 'Bank leg',
      debitMinor: source.amountMinor,
    },
    {
      account: systemKeyRef('sales_revenue'),
      description: 'Revenue leg',
      creditMinor: source.amountMinor,
    },
  ],
};

describe('declarative posting rules against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let rules: PostingRulesService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let bankAccountId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    rules = harness.app.get(PostingRulesService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'posting-rules-owner@example.test',
        displayName: 'Posting Rules Owner',
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
      { legalName: 'Posting Rule Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const bank = await ledger.accountBySystemKey(context.id, 'bank_default');
    bankAccountId = bank.id;
  });

  function sourceFor(overrides: Partial<SimpleSource> = {}): SimpleSource {
    return {
      sourceId: `SRC-${Math.random().toString(36).slice(2, 10)}`,
      journalDate: new Date('2026-02-10T00:00:00.000Z'),
      currency: 'KES',
      amountMinor: 2500n,
      bankAccountId,
      ...overrides,
    };
  }

  it('posts a balanced journal through a rule with full source and rule traceability', async () => {
    const posted = await rules.post(
      context,
      owner,
      balancedRule,
      sourceFor(),
      metadata,
      'rule-key-1',
    );

    expect(posted.sourceType).toBe('RULE_TEST');
    expect(posted.postingRule).toBe('RULE_TEST_EVENT@v3');
    expect(posted.totals.balanced).toBe(true);
    expect(posted.totals.debitMinor).toBe('2500');

    const revenueAccount = await ledger.accountBySystemKey(context.id, 'sales_revenue');
    const debitLine = posted.lines.find((line) => line.accountId === bankAccountId);
    const creditLine = posted.lines.find((line) => line.accountId === revenueAccount.id);
    expect(debitLine?.debitMinor).toBe('2500');
    expect(debitLine?.description).toBe('Bank leg');
    expect(creditLine?.creditMinor).toBe('2500');
    expect(creditLine?.description).toBe('Revenue leg');
  });

  it('rejects an unbalanced rule before any journal row exists', async () => {
    const unbalanced: PostingRule<SimpleSource> = {
      ...balancedRule,
      event: 'RULE_TEST_UNBALANCED',
      lines: (source) => [
        { account: accountIdRef(source.bankAccountId), debitMinor: source.amountMinor },
        { account: systemKeyRef('sales_revenue'), creditMinor: source.amountMinor - 1n },
      ],
    };

    await expect(rules.post(context, owner, unbalanced, sourceFor(), metadata)).rejects.toThrow(
      /unbalanced journal \(DR 2500 vs CR 2499\)/,
    );

    expect(await harness.prisma.journal.count({ where: { organizationId: context.id } })).toBe(0);
    expect(await harness.prisma.journalLine.count({ where: { organizationId: context.id } })).toBe(
      0,
    );
  });

  it('fails closed on an unknown explicit account id without writing anything', async () => {
    const badAccount: PostingRule<SimpleSource> = {
      ...balancedRule,
      event: 'RULE_TEST_BAD_ACCOUNT',
      lines: (source) => [
        {
          account: accountIdRef('00000000-0000-4000-8000-000000000000'),
          debitMinor: source.amountMinor,
        },
        { account: systemKeyRef('sales_revenue'), creditMinor: source.amountMinor },
      ],
    };

    await expect(rules.post(context, owner, badAccount, sourceFor(), metadata)).rejects.toThrow(
      /unknown or inactive account/,
    );
    expect(await harness.prisma.journal.count({ where: { organizationId: context.id } })).toBe(0);
  });

  it('atomically replays a same-idempotency-key rule post instead of double-posting', async () => {
    const source = sourceFor();
    const first = await rules.post(context, owner, balancedRule, source, metadata, 'same-rule-key');
    const replay = await rules.post(
      context,
      owner,
      balancedRule,
      source,
      metadata,
      'same-rule-key',
    );

    expect(replay.id).toBe(first.id);
    expect(await harness.prisma.journal.count({ where: { organizationId: context.id } })).toBe(1);
    expect(
      await harness.prisma.ledgerIdempotencyKey.count({
        where: { organizationId: context.id, operation: 'RULE_TEST_EVENT' },
      }),
    ).toBe(1);
  });

  it('joins a caller-supplied transaction so the whole surrounding operation is atomic', async () => {
    const source = sourceFor();
    await harness.prisma
      .$transaction(async (tx) => {
        const inside = await rules.post(
          context,
          owner,
          balancedRule,
          source,
          metadata,
          undefined,
          tx,
        );
        expect(inside.status).toBe('POSTED');
        // Deliberately roll back by throwing after the post -- everything, including the journal,
        // must disappear together.
        throw new Error('rollback-probe');
      })
      .catch(() => undefined);

    expect(await harness.prisma.journal.count({ where: { organizationId: context.id } })).toBe(0);
  });
});
