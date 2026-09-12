import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';

import {
  AUTOMATION_JOB_NAMES,
  AUTOMATION_QUEUE_NAME,
  type AutomationJob,
  type AutomationJobName,
  type DomainEventJob,
  type ScheduledExecutionJob,
} from './automation-job.js';
import { DomainEventsService } from './domain-events.service.js';
import { RecurringScheduleRunnerService } from './recurring-schedule-runner.service.js';
import { RemindersService } from './reminders.service.js';
import { ScheduledReportRunnerService } from './scheduled-report-runner.service.js';
import { SchedulerService } from './scheduler.service.js';
import { WorkflowsService } from './workflows.service.js';
import { workerConnection } from '../jobs/redis-connection.js';

/**
 * Consumer boundary for Phase 10. Event/rule and schedule handlers are registered here as their
 * vertical slices land; unknown jobs fail loudly rather than being silently acknowledged.
 */
@Injectable()
export class AutomationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationWorker.name);
  private worker?: Worker<AutomationJob, void, AutomationJobName>;

  constructor(
    private readonly config: ConfigService,
    private readonly events: DomainEventsService,
    private readonly workflows: WorkflowsService,
    private readonly recurring: RecurringScheduleRunnerService,
    private readonly scheduledReports: ScheduledReportRunnerService,
    private readonly scheduler: SchedulerService,
    private readonly reminders: RemindersService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AutomationJob, void, AutomationJobName>(
      AUTOMATION_QUEUE_NAME,
      async (job) => this.process(job),
      {
        connection: workerConnection(this.config.getOrThrow<string>('REDIS_URL')),
        prefix: this.config.get<string>('QUEUE_PREFIX') ?? 'retailbooks',
        concurrency: Number(this.config.get('AUTOMATION_WORKER_CONCURRENCY') ?? 4),
        metrics: { maxDataPoints: 14 * 24 * 60 },
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error({
        message: 'Automation job failed',
        jobId: job?.id,
        name: job?.name,
        error,
      }),
    );
    this.worker.on('error', (error) =>
      this.logger.error({ message: 'Automation worker error', error }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<AutomationJob, void, AutomationJobName>): Promise<void> {
    if (job.name === AUTOMATION_JOB_NAMES.domainEvent) {
      // BullMQ's `Job<Union, ...>` does not link `name` and `data` as a true discriminated union --
      // narrowing on `name` alone does not narrow `data`'s type -- so the cast below is what actually
      // recovers the shape this branch's job name guarantees.
      const data = job.data as DomainEventJob;
      const event = await this.events.findDispatched(data.eventId);
      if (!event) return;
      await this.workflows.consumeEvent(event.id);
      return;
    }
    if (job.name === AUTOMATION_JOB_NAMES.scheduledExecution) {
      const data = job.data as ScheduledExecutionJob;
      const handler = await this.scheduler.handlerForExecution(data.executionId);
      if (!handler) return;
      if (handler === 'report.scheduled') await this.scheduledReports.execute(data.executionId);
      else if (handler.startsWith('recurring.')) await this.recurring.execute(data.executionId);
      else if (handler === 'invoice.reminder') await this.reminders.execute(data.executionId);
      else throw new Error(`No scheduled handler is registered for ${handler}.`);
      return;
    }
    const neverName: never = job.name;
    throw new Error(`Unknown automation job ${String(neverName)}`);
  }
}
