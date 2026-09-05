import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledJobExecutionStatus, ScheduledJobStatus } from '@prisma/client';
import type { PublicUser } from '../src/auth/auth.service.js';
import { AutomationQueueService } from '../src/automation/automation-queue.service.js';
import { SchedulerService } from '../src/automation/scheduler.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'scheduler-sweep-test',
  userAgent: 'RetailBooks integration test',
};

describe('scheduler sweep and execution lifecycle against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let scheduler: SchedulerService;
  let automationQueue: AutomationQueueService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    scheduler = harness.app.get(SchedulerService);
    automationQueue = harness.app.get(AutomationQueueService);

    // Nothing here needs stopping: AutomationWorkerModule (the BullMQ consumer and the
    // scheduler poller) only exists in worker-app.module.ts, never in AppModule, so the
    // test harness has no background loops -- enqueued jobs simply sit in BullMQ and
    // execution rows stay QUEUED until the test drives them explicitly.
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
        email: 'sweep-owner@example.test',
        displayName: 'Sweep Owner',
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
      { legalName: 'Sweep Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
  });

  function createJob(schedule: Parameters<SchedulerService['createJob']>[0]['schedule']) {
    return scheduler.createJob({
      organizationId: context.id,
      createdByUserId: owner.id,
      handler: 'SCHEDULED_REPORT',
      sourceType: 'SCHEDULED_REPORT',
      sourceId: '00000000-0000-4000-8000-000000000001',
      schedule,
      timeZone: 'Africa/Nairobi',
    });
  }

  describe('sweep concurrency', () => {
    it('claims a due job exactly once across concurrent sweeps', async () => {
      const job = await createJob({ cadence: 'DAILY', localTime: '09:00' });
      const dueAt = new Date(Date.now() - 60_000);
      await harness.prisma.scheduledJob.update({
        where: { id: job.id },
        data: { nextRunAt: dueAt },
      });

      const now = new Date();
      const results = await Promise.all([scheduler.sweep(now), scheduler.sweep(now)]);
      expect(results[0] + results[1]).toBe(1);

      const executions = await harness.prisma.scheduledJobExecution.findMany({
        where: { scheduledJobId: job.id },
      });
      expect(executions).toHaveLength(1);
      expect(executions[0]!.status).toBe(ScheduledJobExecutionStatus.QUEUED);
      expect(executions[0]!.occurrenceKey).toBe(dueAt.toISOString());

      // The claim advanced nextRunAt past `now`, so an immediate re-sweep is a no-op.
      expect(await scheduler.sweep(now)).toBe(0);
      expect(
        await harness.prisma.scheduledJobExecution.count({ where: { scheduledJobId: job.id } }),
      ).toBe(1);
    });
  });

  describe('end date', () => {
    it('marks a job COMPLETED once its final occurrence is claimed and never claims again', async () => {
      const job = await createJob({ cadence: 'DAILY', localTime: '09:00' });
      // 2026-06-10T09:00Z is 2026-06-10 in Africa/Nairobi (+03) — the endDate itself. The
      // occurrence due on the end date is the last one claimed; the job completes right after.
      await harness.prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          nextRunAt: new Date('2026-06-10T09:00:00.000Z'),
          schedule: { cadence: 'DAILY', localTime: '09:00', endDate: '2026-06-10' },
        },
      });

      expect(await scheduler.sweep(new Date('2026-06-11T00:00:00.000Z'))).toBe(1);

      const completed = await harness.prisma.scheduledJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(completed.status).toBe(ScheduledJobStatus.COMPLETED);
      expect(completed.completedAt).not.toBeNull();

      expect(await scheduler.sweep(new Date('2026-06-12T00:00:00.000Z'))).toBe(0);
      expect(
        await harness.prisma.scheduledJobExecution.count({ where: { scheduledJobId: job.id } }),
      ).toBe(1);
    });

    it('keeps an ACTIVE job whose endDate is still ahead of its next occurrence', async () => {
      const job = await createJob({ cadence: 'DAILY', localTime: '09:00' });
      await harness.prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          nextRunAt: new Date('2026-06-10T09:00:00.000Z'),
          schedule: { cadence: 'DAILY', localTime: '09:00', endDate: '2026-06-15' },
        },
      });

      expect(await scheduler.sweep(new Date('2026-06-11T00:00:00.000Z'))).toBe(1);

      const active = await harness.prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(active.status).toBe(ScheduledJobStatus.ACTIVE);
      expect(active.completedAt).toBeNull();
      expect(active.nextRunAt).not.toBeNull();
    });
  });
});
