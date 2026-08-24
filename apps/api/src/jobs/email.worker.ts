import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';

import { EmailDeliveryService } from './email-delivery.service.js';
import { EMAIL_QUEUE_NAME, type EmailDeliveryJob, type EmailJobName } from './email-job.js';
import { workerConnection } from './redis-connection.js';

@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorker.name);
  private worker?: Worker<EmailDeliveryJob, void, EmailJobName>;

  constructor(
    private readonly config: ConfigService,
    private readonly delivery: EmailDeliveryService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<EmailDeliveryJob, void, EmailJobName>(
      EMAIL_QUEUE_NAME,
      async (job: Job<EmailDeliveryJob, void, EmailJobName>) => {
        await this.delivery.deliver(job.data);
      },
      {
        connection: workerConnection(this.config.get<string>('REDIS_URL')),
        prefix: this.config.get<string>('QUEUE_PREFIX') ?? 'retailbooks',
        concurrency: Number(this.config.get('EMAIL_WORKER_CONCURRENCY') ?? 4),
        metrics: { maxDataPoints: 14 * 24 * 60 },
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log({
        message: 'Transactional email delivered',
        jobId: job.id,
        jobName: job.name,
      });
    });
    this.worker.on('failed', (job, error) => {
      const attempts = job?.opts.attempts ?? 1;
      const exhausted = (job?.attemptsMade ?? attempts) >= attempts;
      const details = {
        message: exhausted
          ? 'Transactional email moved to the failed queue after exhausting retries'
          : 'Transactional email delivery failed; BullMQ will retry it',
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        attempts,
        exhausted,
        error,
      };
      if (exhausted) this.logger.error(details);
      else this.logger.warn(details);
    });
    this.worker.on('error', (error) => {
      this.logger.error({ message: 'Email worker error', error });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
