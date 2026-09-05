import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledJobExecutionStatus } from '@prisma/client';
import type { PublicUser } from '../src/auth/auth.service.js';
import { AutomationQueueService } from '../src/automation/automation-queue.service.js';
import { SchedulerService } from '../src/automation/scheduler.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'automation-jobs-test',
  userAgent: 'RetailBooks integration test',
};

describe('failed scheduled-job execution retries against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let scheduler: SchedulerService;
  let automationQueue: AutomationQueueService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let otherOrgId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    scheduler = harness.app.get(SchedulerService);
    automationQueue = harness.app.get(AutomationQueueService);

    // Nothing here needs stopping: AutomationWorkerModule (the BullMQ consumer and the
    // scheduler poller) only exists in worker-app.module.ts, never in AppModule, so the
    // test harness has no background loops -- re-enqueued retry jobs simply sit in
    // BullMQ and the execution row stays QUEUED for the assertions below.
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    vi.spyOn(automationQueue, 'enqueueScheduledExecution').mockResolvedValue();
    vi.spyOn(automationQueue, 'retryScheduledExecution').mockResolvedValue();
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'jobs-owner@example.test',
        displayName: 'Jobs Owner',
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
      { legalName: 'Job Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);

    const other = await organizations.create(
      owner,
      { legalName: 'Other Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    otherOrgId = other.id;
  });

  /** A real ACTIVE job plus a FAILED execution row seeded straight through Prisma. */
  async function createFailedExecution() {
    const job = await scheduler.createJob({
      organizationId: context.id,
      createdByUserId: owner.id,
      handler: 'SCHEDULED_REPORT',
      sourceType: 'SCHEDULED_REPORT',
      sourceId: '00000000-0000-4000-8000-000000000001',
      schedule: { cadence: 'DAILY', localTime: '09:00' },
      timeZone: 'Africa/Nairobi',
    });
    const execution = await harness.prisma.scheduledJobExecution.create({
      data: {
        organizationId: context.id,
        scheduledJobId: job.id,
        occurrenceKey: new Date('2026-06-10T09:00:00.000Z').toISOString(),
        status: ScheduledJobExecutionStatus.FAILED,
        startedAt: new Date('2026-06-10T09:00:01.000Z'),
        completedAt: new Date('2026-06-10T09:00:02.000Z'),
        attempts: 1,
        error: 'boom: report rendering failed',
      },
    });
    return { job, execution };
  }

  it('resets a FAILED execution to QUEUED, clears the error, and writes the retry audit event', async () => {
    const { execution } = await createFailedExecution();

    const retried = await scheduler.retryExecution(context.id, owner, execution.id, metadata);
    expect(retried.status).toBe(ScheduledJobExecutionStatus.QUEUED);
    expect(retried.error).toBeNull();
    expect(retried.completedAt).toBeNull();

    const reread = await harness.prisma.scheduledJobExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(reread.status).toBe(ScheduledJobExecutionStatus.QUEUED);
    expect(reread.error).toBeNull();

    const audit = await harness.prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId: context.id,
        eventKey: 'automation.job_execution_retried',
        entityType: 'scheduled_job_execution',
        entityId: execution.id,
      },
    });
    expect(audit.actorUserId).toBe(owner.id);
    expect(audit.action).toBe('UPDATE');
  });

  it('rejects retrying an execution that is no longer FAILED', async () => {
    const { execution } = await createFailedExecution();
    await scheduler.retryExecution(context.id, owner, execution.id, metadata);

    await expect(
      scheduler.retryExecution(context.id, owner, execution.id, metadata),
    ).rejects.toThrow('Only failed executions can be retried.');
  });

  it('does not let another organization retry an execution it does not own', async () => {
    const { execution } = await createFailedExecution();

    await expect(
      scheduler.retryExecution(otherOrgId, owner, execution.id, metadata),
    ).rejects.toThrow('Scheduled job execution not found.');

    const untouched = await harness.prisma.scheduledJobExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(untouched.status).toBe(ScheduledJobExecutionStatus.FAILED);
    expect(untouched.error).toBe('boom: report rendering failed');
  });
});
