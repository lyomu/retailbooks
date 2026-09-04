import { DomainEventState } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { DomainEventsService } from '../src/automation/domain-events.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'outbox-test',
  userAgent: 'RetailBooks integration test',
};

describe('domain event outbox atomicity against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let events: DomainEventsService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    events = harness.app.get(DomainEventsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'outbox-owner@example.test',
        displayName: 'Outbox Owner',
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
      { legalName: 'Outbox Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    context = await access.requireMembership(owner.id, created.id);
  });

  it('emits exactly one row for a committed mutation', async () => {
    await harness.prisma.$transaction(async (tx) => {
      await events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'invoice',
        aggregateId: 'test-aggregate-1',
        eventName: 'invoice.issued',
        payload: { invoiceId: 'test-aggregate-1' },
      });
    });

    const rows = await harness.prisma.domainEventOutbox.findMany({
      where: { organizationId: context.id, aggregateId: 'test-aggregate-1' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe(DomainEventState.PENDING);
  });

  it('emits nothing when the transaction that called emit() rolls back', async () => {
    await expect(
      harness.prisma.$transaction(async (tx) => {
        await events.emit(tx, {
          organizationId: context.id,
          aggregateType: 'invoice',
          aggregateId: 'test-aggregate-rollback',
          eventName: 'invoice.issued',
          payload: {},
        });
        throw new Error('Simulated failure after emit, before commit.');
      }),
    ).rejects.toThrow('Simulated failure after emit, before commit.');

    const rows = await harness.prisma.domainEventOutbox.findMany({
      where: { organizationId: context.id, aggregateId: 'test-aggregate-rollback' },
    });
    expect(rows).toHaveLength(0);
  });

  it('claims a pending row exactly once under concurrent claimBatch calls', async () => {
    await harness.prisma.$transaction(async (tx) => {
      await events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'invoice',
        aggregateId: 'test-aggregate-concurrent',
        eventName: 'invoice.issued',
        payload: {},
      });
    });

    const [first, second] = await Promise.all([
      events.claimBatch(50, 60),
      events.claimBatch(50, 60),
    ]);
    const claimedIds = [...first, ...second].filter(
      (event) => event.aggregateId === 'test-aggregate-concurrent',
    );
    expect(claimedIds).toHaveLength(1);
  });

  it('recovers an abandoned lease so a later sweep can reclaim it', async () => {
    const id = await harness.prisma.$transaction((tx) =>
      events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'invoice',
        aggregateId: 'test-aggregate-abandoned',
        eventName: 'invoice.issued',
        payload: {},
      }),
    );

    // Claim it with a lease that has already expired by the time we check again.
    const claimed = await events.claimBatch(50, -1);
    expect(claimed.some((event) => event.id === id)).toBe(true);

    const reclaimed = await events.claimBatch(50, 60);
    expect(reclaimed.some((event) => event.id === id)).toBe(true);
  });

  it('marks a dispatched event terminal so a duplicate dispatch attempt finds nothing to claim', async () => {
    const id = await harness.prisma.$transaction((tx) =>
      events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'invoice',
        aggregateId: 'test-aggregate-dispatched',
        eventName: 'invoice.issued',
        payload: {},
      }),
    );
    const [claimed] = await events.claimBatch(50, 60);
    expect(claimed?.id).toBe(id);
    await events.markDispatched(id);

    const found = await events.findDispatched(id);
    expect(found?.state).toBe(DomainEventState.DISPATCHED);

    const nothingLeftToClaim = await events.claimBatch(50, 60);
    expect(nothingLeftToClaim.some((event) => event.id === id)).toBe(false);
  });

  it("backs off exponentially based on the row's own attempts, not a fixed interval", async () => {
    const id = await harness.prisma.$transaction((tx) =>
      events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'invoice',
        aggregateId: 'test-aggregate-backoff',
        eventName: 'invoice.issued',
        payload: {},
      }),
    );

    // Drive `attempts` directly rather than through claimBatch()'s own availability window, which
    // would otherwise make a second claim wait out the first release's backoff before it could fire.
    await harness.prisma.domainEventOutbox.update({ where: { id }, data: { attempts: 1 } });
    const beforeFirst = Date.now();
    await events.release(id, new Error('dispatch failed'));
    const afterFirst = await harness.prisma.domainEventOutbox.findUniqueOrThrow({ where: { id } });
    const firstDelayMs = afterFirst.availableAt.getTime() - beforeFirst;
    expect(firstDelayMs).toBeGreaterThanOrEqual(900); // ~1s base delay
    expect(firstDelayMs).toBeLessThan(3_000);

    await harness.prisma.domainEventOutbox.update({ where: { id }, data: { attempts: 2 } });
    const beforeSecond = Date.now();
    await events.release(id, new Error('dispatch failed again'));
    const afterSecond = await harness.prisma.domainEventOutbox.findUniqueOrThrow({ where: { id } });
    const secondDelayMs = afterSecond.availableAt.getTime() - beforeSecond;
    expect(secondDelayMs).toBeGreaterThanOrEqual(1_900); // ~2s, double the first attempt's delay
    expect(secondDelayMs).toBeLessThan(5_000);
  });
});
