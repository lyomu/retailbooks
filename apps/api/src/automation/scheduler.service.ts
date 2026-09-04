import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  ScheduledJobExecutionStatus,
  ScheduledJobMisfirePolicy,
  ScheduledJobStatus,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { AutomationQueueService } from './automation-queue.service.js';
import { CLOCK, type Clock } from './clock.js';
import { PrismaService } from '../database/prisma.service.js';

export type CalendarSchedule = {
  cadence: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
  localTime?: string;
  weekday?: number;
  dayOfMonth?: number;
  /** ISO date (`YYYY-MM-DD`), organization-local. The occurrence due on or after this date is the
   * last one claimed; the job is marked `COMPLETED` immediately after so no later sweep re-queries it. */
  endDate?: string;
};

/**
 * Owns `nextRunAt` and creates one immutable execution record per due occurrence. Handler logic is
 * intentionally separate: worker retries replay the same execution ID, never create another one.
 */
@Injectable()
export class SchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AutomationQueueService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createJob(input: {
    organizationId: string;
    createdByUserId: string;
    handler: string;
    sourceType: string;
    sourceId: string;
    payload?: Prisma.InputJsonObject;
    schedule: CalendarSchedule;
    timeZone: string;
    misfirePolicy?: ScheduledJobMisfirePolicy;
  }) {
    const nextRunAt = nextOccurrence(this.clock.now(), input.schedule, input.timeZone);
    return this.prisma.scheduledJob.create({
      data: {
        organizationId: input.organizationId,
        createdByUserId: input.createdByUserId,
        handler: input.handler,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        payload: input.payload ?? {},
        schedule: input.schedule,
        timeZone: input.timeZone,
        misfirePolicy: input.misfirePolicy ?? ScheduledJobMisfirePolicy.RUN_ONCE,
        nextRunAt,
      },
    });
  }

  /** Can be called by the worker poller once all handlers are registered. */
  async sweep(now = this.clock.now(), limit = 100): Promise<number> {
    const jobs = await this.prisma.scheduledJob.findMany({
      where: { status: ScheduledJobStatus.ACTIVE, nextRunAt: { lte: now } },
      select: { id: true },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
    let enqueued = 0;
    for (const job of jobs) {
      const execution = await this.claimDueOccurrence(job.id, now);
      if (!execution) continue;
      try {
        await this.queue.enqueueScheduledExecution(execution.id);
        enqueued += 1;
      } catch (error) {
        await this.prisma.scheduledJobExecution.update({
          where: { id: execution.id },
          data: {
            error:
              error instanceof Error
                ? error.message.slice(0, 8_000)
                : String(error).slice(0, 8_000),
          },
        });
      }
    }
    return enqueued;
  }

  /** Re-enqueues durable queued rows after a Redis outage without changing occurrence history. */
  async replayQueued(limit = 100): Promise<number> {
    const queued = await this.prisma.scheduledJobExecution.findMany({
      where: { status: ScheduledJobExecutionStatus.QUEUED },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const execution of queued) await this.queue.enqueueScheduledExecution(execution.id);
    return queued.length;
  }

  async beginExecution(executionId: string) {
    const updated = await this.prisma.scheduledJobExecution.updateMany({
      where: { id: executionId, status: ScheduledJobExecutionStatus.QUEUED },
      data: {
        status: ScheduledJobExecutionStatus.RUNNING,
        startedAt: this.clock.now(),
        attempts: { increment: 1 },
      },
    });
    if (!updated.count) return null;
    return this.prisma.scheduledJobExecution.findUnique({
      where: { id: executionId },
      include: { scheduledJob: true },
    });
  }

  async handlerForQueuedExecution(executionId: string) {
    const execution = await this.prisma.scheduledJobExecution.findFirst({
      where: { id: executionId, status: ScheduledJobExecutionStatus.QUEUED },
      select: { scheduledJob: { select: { handler: true } } },
    });
    return execution?.scheduledJob.handler ?? null;
  }

  async completeExecution(executionId: string, result: Prisma.InputJsonObject = {}) {
    return this.prisma.scheduledJobExecution.update({
      where: { id: executionId },
      data: {
        status: ScheduledJobExecutionStatus.SUCCEEDED,
        completedAt: this.clock.now(),
        result,
        error: null,
      },
    });
  }

  async failExecution(executionId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return this.prisma.scheduledJobExecution.update({
      where: { id: executionId },
      data: {
        status: ScheduledJobExecutionStatus.FAILED,
        completedAt: this.clock.now(),
        error: message.slice(0, 8_000),
      },
    });
  }

  /** Organization-scoped, most recently failed first -- the source list for a manual retry. */
  async listFailedExecutions(organizationId: string, limit = 100) {
    return this.prisma.scheduledJobExecution.findMany({
      where: { organizationId, status: ScheduledJobExecutionStatus.FAILED },
      orderBy: { completedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        scheduledJob: {
          select: { id: true, handler: true, sourceType: true, sourceId: true, status: true },
        },
      },
    });
  }

  /** One execution's full detail -- its own row plus the parent job's schedule/payload context. */
  async getExecution(organizationId: string, executionId: string) {
    const execution = await this.prisma.scheduledJobExecution.findFirst({
      where: { id: executionId, organizationId },
      include: { scheduledJob: true },
    });
    if (!execution) throw new NotFoundException('Scheduled job execution not found.');
    return execution;
  }

  /**
   * Resets one failed execution back to `QUEUED` and re-enqueues it. The unique
   * `(scheduledJobId, occurrenceKey)` constraint means a retry cannot insert a fresh execution row
   * for the same occurrence the way `claimDueOccurrence` does for a new one -- it reuses this row,
   * so its history (`attempts`, prior `error`) does not survive past the retry.
   */
  async retryExecution(
    organizationId: string,
    user: PublicUser,
    executionId: string,
    metadata: RequestMetadata,
  ) {
    const reset = await this.prisma.$transaction(async (tx) => {
      const execution = await tx.scheduledJobExecution.findFirst({
        where: { id: executionId, organizationId },
      });
      if (!execution) throw new NotFoundException('Scheduled job execution not found.');
      if (execution.status !== ScheduledJobExecutionStatus.FAILED) {
        throw new ConflictException('Only failed executions can be retried.');
      }
      const updated = await tx.scheduledJobExecution.update({
        where: { id: executionId },
        data: { status: ScheduledJobExecutionStatus.QUEUED, error: null, completedAt: null },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId: user.id,
        eventKey: 'automation.job_execution_retried',
        entityType: 'scheduled_job_execution',
        entityId: executionId,
        action: AuditAction.UPDATE,
        before: { status: 'FAILED' },
        after: { status: 'QUEUED' },
        ipHash: metadata.ipHash,
      });
      return updated;
    });
    await this.queue.retryScheduledExecution(executionId);
    return reset;
  }

  private async claimDueOccurrence(jobId: string, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ claimed: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`scheduled-job:${jobId}`}, 0)) AS claimed
      `;
      if (!lock[0]?.claimed) return null;
      const job = await tx.scheduledJob.findFirst({
        where: { id: jobId, status: ScheduledJobStatus.ACTIVE, nextRunAt: { lte: now } },
      });
      if (!job) return null;
      const schedule = parseSchedule(job.schedule);
      const occurrenceKey = job.nextRunAt.toISOString();
      const execution = await tx.scheduledJobExecution.create({
        data: {
          organizationId: job.organizationId,
          scheduledJobId: job.id,
          occurrenceKey,
          status: ScheduledJobExecutionStatus.QUEUED,
        },
      });
      const nextRunAt = nextForMisfire(
        job.nextRunAt,
        now,
        schedule,
        job.timeZone,
        job.misfirePolicy,
      );
      const isFinalOccurrence = pastEndDate(job.nextRunAt, job.timeZone, schedule.endDate);
      await tx.scheduledJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: job.nextRunAt,
          nextRunAt,
          status: isFinalOccurrence ? ScheduledJobStatus.COMPLETED : undefined,
          completedAt: isFinalOccurrence ? this.clock.now() : undefined,
          updatedAt: this.clock.now(),
        },
      });
      return execution;
    });
  }
}

function parseSchedule(value: Prisma.JsonValue): CalendarSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Scheduled job has an invalid schedule.');
  const schedule = value as Partial<CalendarSchedule>;
  if (
    !schedule.cadence ||
    !['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'].includes(schedule.cadence)
  ) {
    throw new Error('Scheduled job has an unsupported cadence.');
  }
  return schedule as CalendarSchedule;
}

function nextForMisfire(
  scheduledAt: Date,
  now: Date,
  schedule: CalendarSchedule,
  timeZone: string,
  policy: ScheduledJobMisfirePolicy,
) {
  if (policy === ScheduledJobMisfirePolicy.SKIP || policy === ScheduledJobMisfirePolicy.RUN_ONCE) {
    return nextOccurrence(now, schedule, timeZone);
  }
  return advanceOccurrence(scheduledAt, schedule, timeZone);
}

/** Calendar arithmetic is deliberately local-time first and converted to a UTC instant afterwards. */
export function nextOccurrence(now: Date, schedule: CalendarSchedule, timeZone: string): Date {
  const local = localParts(now, timeZone);
  const { hour, minute } = parseLocalTime(schedule.localTime);
  let candidate = { year: local.year, month: local.month, day: local.day, hour, minute };
  if (toUtc(candidate, timeZone).getTime() <= now.getTime())
    candidate = advanceLocal(candidate, schedule);
  while (!matchesCadence(candidate, schedule, local))
    candidate = advanceLocal(candidate, { ...schedule, cadence: 'DAILY' });
  return toUtc(candidate, timeZone);
}

function advanceOccurrence(current: Date, schedule: CalendarSchedule, timeZone: string): Date {
  const local = localParts(current, timeZone);
  const { hour, minute } = parseLocalTime(schedule.localTime);
  return toUtc(
    advanceLocal({ year: local.year, month: local.month, day: local.day, hour, minute }, schedule),
    timeZone,
  );
}

function parseLocalTime(value: string | undefined): { hour: number; minute: number } {
  const [hourPart, minutePart] = (value ?? '00:00').split(':');
  return { hour: Number(hourPart ?? 0), minute: Number(minutePart ?? 0) };
}

function matchesCadence(candidate: LocalDate, schedule: CalendarSchedule, now: LocalDate): boolean {
  if (schedule.cadence === 'DAILY') return true;
  if (schedule.cadence === 'WEEKLY')
    return weekday(candidate) === (schedule.weekday ?? weekday(now));
  if (schedule.cadence === 'MONTHLY')
    return (
      candidate.day ===
      Math.min(schedule.dayOfMonth ?? now.day, daysInMonth(candidate.year, candidate.month))
    );
  if (schedule.cadence === 'QUARTERLY')
    return (
      candidate.month % 3 === now.month % 3 &&
      candidate.day ===
        Math.min(schedule.dayOfMonth ?? now.day, daysInMonth(candidate.year, candidate.month))
    );
  return (
    candidate.month === now.month &&
    candidate.day ===
      Math.min(schedule.dayOfMonth ?? now.day, daysInMonth(candidate.year, candidate.month))
  );
}

type LocalDate = { year: number; month: number; day: number; hour: number; minute: number };

function advanceLocal(value: LocalDate, schedule: CalendarSchedule): LocalDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute));
  if (schedule.cadence === 'DAILY') date.setUTCDate(date.getUTCDate() + 1);
  else if (schedule.cadence === 'WEEKLY') date.setUTCDate(date.getUTCDate() + 7);
  else if (schedule.cadence === 'MONTHLY') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (schedule.cadence === 'QUARTERLY') date.setUTCMonth(date.getUTCMonth() + 3);
  else date.setUTCFullYear(date.getUTCFullYear() + 1);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

/** True when the occurrence's organization-local calendar date is on or after `endDate`. */
function pastEndDate(occurrence: Date, timeZone: string, endDate: string | undefined): boolean {
  if (!endDate) return false;
  const local = localParts(occurrence, timeZone);
  const occurrenceDate = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  return occurrenceDate >= endDate;
}

function localParts(instant: Date, timeZone: string): LocalDate {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((item) => item.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

function toUtc(local: LocalDate, timeZone: string): Date {
  const wallClock = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let candidate = new Date(wallClock - timeZoneOffset(new Date(wallClock), timeZone));
  candidate = new Date(wallClock - timeZoneOffset(candidate, timeZone));
  return candidate;
}

function timeZoneOffset(instant: Date, timeZone: string) {
  const parts = localParts(instant, timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant.getTime()
  );
}

function weekday(value: LocalDate) {
  return new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Keep randomUUID imported in this source while scheduler job IDs remain database generated; it is
// the explicit seam for future worker correlation IDs and avoids changing the scheduling API later.
void randomUUID;
