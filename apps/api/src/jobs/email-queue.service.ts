import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { EMAIL_QUEUE_NAME, type EmailDeliveryJob, type EmailJobName } from './email-job.js';
import { producerConnection } from './redis-connection.js';

export type EmailQueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
};

@Injectable()
export class EmailQueueService implements OnModuleDestroy {
  private readonly queue: Queue<EmailDeliveryJob, void, EmailJobName>;

  constructor(config: ConfigService) {
    this.queue = new Queue<EmailDeliveryJob, void, EmailJobName>(EMAIL_QUEUE_NAME, {
      connection: producerConnection(config.getOrThrow<string>('REDIS_URL')),
      prefix: config.get<string>('QUEUE_PREFIX') ?? 'retailbooks',
      skipWaitingForReady: true,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: Number(config.get('EMAIL_JOB_RETRY_DELAY_MS') ?? 1_000),
        },
        removeOnComplete: { age: 3_600, count: 1_000 },
        // Exhausted jobs are the queue's dead-letter set. Keep them until an operator retries or
        // removes them so readiness can surface delivery loss.
        removeOnFail: false,
      },
    });
  }

  async enqueue(name: EmailJobName, data: EmailDeliveryJob): Promise<void> {
    await this.queue.add(name, data);
  }

  async counts(): Promise<EmailQueueCounts> {
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
