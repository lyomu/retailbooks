import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  AUTOMATION_JOB_NAMES,
  AUTOMATION_QUEUE_NAME,
  type AutomationJob,
  type AutomationJobName,
} from './automation-job.js';
import { producerConnection } from '../jobs/redis-connection.js';

export type AutomationQueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
};

@Injectable()
export class AutomationQueueService implements OnModuleDestroy {
  private readonly queue: Queue<AutomationJob, void, AutomationJobName>;

  constructor(config: ConfigService) {
    this.queue = new Queue<AutomationJob, void, AutomationJobName>(AUTOMATION_QUEUE_NAME, {
      connection: producerConnection(config.get<string>('REDIS_URL')),
      prefix: config.get<string>('QUEUE_PREFIX') ?? 'retailbooks',
      skipWaitingForReady: true,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: Number(config.get('AUTOMATION_RETRY_DELAY_MS') ?? 1_000),
        },
        removeOnComplete: { age: 3_600, count: 5_000 },
        removeOnFail: false,
      },
    });
  }

  async enqueueDomainEvent(eventId: string): Promise<void> {
    await this.queue.add(
      AUTOMATION_JOB_NAMES.domainEvent,
      { eventId },
      { jobId: `event-${eventId}` },
    );
  }

  async enqueueScheduledExecution(executionId: string): Promise<void> {
    await this.queue.add(
      AUTOMATION_JOB_NAMES.scheduledExecution,
      { executionId },
      { jobId: `schedule-${executionId}` },
    );
  }

  /**
   * Re-enqueues a specific execution after a manual retry. `enqueueScheduledExecution` uses a
   * deterministic `jobId` so BullMQ can dedupe automatic re-queues; that same determinism means a
   * plain `add()` here would silently no-op against the old job's terminal (failed/completed)
   * record instead of running again, so the stale job is removed first.
   */
  async retryScheduledExecution(executionId: string): Promise<void> {
    const jobId = `schedule-${executionId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed' || state === 'completed') {
        await existing.remove();
      } else {
        return;
      }
    }
    await this.queue.add(AUTOMATION_JOB_NAMES.scheduledExecution, { executionId }, { jobId });
  }

  async counts(): Promise<AutomationQueueCounts> {
    const counts = await this.queue.getJobCounts('wait', 'active', 'delayed', 'failed');
    return {
      waiting: counts.wait ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
