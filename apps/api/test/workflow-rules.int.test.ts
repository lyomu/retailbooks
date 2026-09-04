import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { DomainEventsService } from '../src/automation/domain-events.service.js';
import { WorkflowsService } from '../src/automation/workflows.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'workflow-rules-test',
  userAgent: 'RetailBooks integration test',
};

describe('workflow rule execution properties against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let events: DomainEventsService;
  let workflows: WorkflowsService;
  let owner: PublicUser;
  let orgA: OrganizationContext;
  let orgB: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    events = harness.app.get(DomainEventsService);
    workflows = harness.app.get(WorkflowsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'workflow-owner@example.test',
        displayName: 'Workflow Owner',
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
    orgA = await createOrganization('Rules Books Ltd');
    orgB = await createOrganization('Other Books Ltd');
  });

  async function createOrganization(legalName: string) {
    const created = await organizations.create(
      owner,
      { legalName, businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    return access.requireMembership(owner.id, created.id);
  }

  /** Mirrors the outbox worker: emit inside a transaction, then mark the row DISPATCHED so
   * `consumeEvent`'s `findDispatched` lookup can see it. */
  async function emitAndDispatch(organizationId: string, payload: Prisma.InputJsonValue) {
    const eventId = await harness.prisma.$transaction((tx) =>
      events.emit(tx, {
        organizationId,
        aggregateType: 'invoice',
        aggregateId: `agg-${randomUUID()}`,
        eventName: 'invoice.issued',
        payload,
      }),
    );
    await events.markDispatched(eventId);
    return eventId;
  }

  async function activeRule(context: OrganizationContext, name: string) {
    const rule = await workflows.create(
      context,
      owner,
      {
        name,
        trigger: 'invoice.issued',
        conditions: [],
        actions: [{ type: 'CREATE_TASK', title: 'Follow up on issued invoice' }],
      },
      metadata,
    );
    await workflows.setStatus(context, owner, rule.id, 'ACTIVE', metadata);
    return rule;
  }

  it('is tenant-scoped: an event in another organization never runs this org\u2019s rules', async () => {
    const rule = await activeRule(orgA, 'org A only');
    const eventId = await emitAndDispatch(orgB.id, { invoiceId: 'other-org-invoice' });

    await workflows.consumeEvent(eventId);

    expect(await harness.prisma.workflowRun.count({ where: { ruleId: rule.id } })).toBe(0);
    expect(await harness.prisma.workflowRun.count({ where: { organizationId: orgB.id } })).toBe(0);
  });

  it('is idempotent: consuming the same dispatched event twice creates exactly one run', async () => {
    const rule = await activeRule(orgA, 'once only');
    const eventId = await emitAndDispatch(orgA.id, { invoiceId: 'inv-1' });

    await workflows.consumeEvent(eventId);
    await workflows.consumeEvent(eventId);

    const runs = await harness.prisma.workflowRun.findMany({ where: { ruleId: rule.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.eventId).toBe(eventId);
    expect(runs[0]?.status).toBe('SUCCEEDED');
  });

  it('processes at most 25 rules per event (MAX_RULES_PER_EVENT)', async () => {
    for (let index = 0; index < 30; index += 1) {
      await harness.prisma.workflowRule.create({
        data: {
          organizationId: orgA.id,
          createdByUserId: owner.id,
          name: `cap rule ${index}`,
          trigger: 'invoice.issued',
          status: 'ACTIVE',
          conditions: [],
          actions: [{ type: 'CREATE_TASK', title: `Task ${index}` }],
        },
      });
    }
    const eventId = await emitAndDispatch(orgA.id, { invoiceId: 'inv-cap' });

    await workflows.consumeEvent(eventId);

    expect(await harness.prisma.workflowRun.count({ where: { organizationId: orgA.id } })).toBe(25);
  });

  it('fails closed: a rule whose creator lost organization access is SKIPPED, not executed', async () => {
    const rule = await activeRule(orgA, 'suspended creator');
    const member = await harness.prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: orgA.id, userId: owner.id },
    });
    await harness.prisma.organizationMember.update({
      where: { id: member.id },
      data: { status: 'SUSPENDED' },
    });
    const eventId = await emitAndDispatch(orgA.id, { invoiceId: 'inv-2' });

    await workflows.consumeEvent(eventId);

    const run = await harness.prisma.workflowRun.findFirstOrThrow({
      where: { ruleId: rule.id, eventId },
    });
    expect(run.status).toBe('SKIPPED');
    expect(JSON.stringify(run.result)).toContain('access');
    expect(await harness.prisma.automationTask.count({ where: { sourceEventId: eventId } })).toBe(
      0,
    );
  });

  it('captures an action failure as FAILED with a non-empty error instead of losing it', async () => {
    const rule = await workflows.create(
      orgA,
      owner,
      {
        name: 'broken recipient',
        trigger: 'invoice.issued',
        conditions: [],
        // The notification table's FK is on `users`, not membership, so a user who merely is not a
        // member would still receive the notification; a nonexistent user id is what reliably makes
        // the action fail inside the action transaction.
        actions: [{ type: 'CREATE_NOTIFICATION', recipientUserId: randomUUID(), title: 'Ping' }],
      },
      metadata,
    );
    await workflows.setStatus(orgA, owner, rule.id, 'ACTIVE', metadata);
    const eventId = await emitAndDispatch(orgA.id, { invoiceId: 'inv-3' });

    // `runRule` rethrows the action error after marking the run FAILED, so the worker's caller (the
    // outbox dispatcher) sees the failure and can release the event for a backoff retry.
    await expect(workflows.consumeEvent(eventId)).rejects.toThrow();

    const run = await harness.prisma.workflowRun.findFirstOrThrow({
      where: { ruleId: rule.id, eventId },
    });
    expect(run.status).toBe('FAILED');
    expect(run.error).toBeTruthy();
    expect(await harness.prisma.notification.count({ where: { organizationId: orgA.id } })).toBe(0);
  });
});
