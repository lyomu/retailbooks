import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailQueueService } from '../src/jobs/email-queue.service';
import { EMAIL_JOB_NAMES, EMAIL_QUEUE_NAME } from '../src/jobs/email-job';
import { EmailWorker } from '../src/jobs/email.worker';
import { producerConnection } from '../src/jobs/redis-connection';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:56379';

describe('email queue against Redis', () => {
  const closeables: Array<{ close: () => Promise<unknown> }> = [];

  afterEach(async () => {
    await Promise.allSettled(
      closeables
        .splice(0)
        .reverse()
        .map((item) => item.close()),
    );
  });

  it('retries a failed delivery five times and retains the exhausted job', async () => {
    const prefix = `retailbooks-test-${randomUUID()}`;
    const config = new ConfigService({
      REDIS_URL: redisUrl,
      QUEUE_PREFIX: prefix,
      EMAIL_JOB_RETRY_DELAY_MS: 10,
      EMAIL_WORKER_CONCURRENCY: 1,
    });
    const delivery = { deliver: vi.fn().mockRejectedValue(new Error('SMTP unavailable')) };
    const queue = new EmailQueueService(config);
    const worker = new EmailWorker(config, delivery as never);
    const admin = new Queue(EMAIL_QUEUE_NAME, {
      connection: producerConnection(redisUrl),
      prefix,
      skipWaitingForReady: true,
    });
    closeables.push(
      admin,
      { close: () => queue.onModuleDestroy() },
      { close: () => worker.onModuleDestroy() },
    );

    worker.onModuleInit();
    await queue.enqueue(EMAIL_JOB_NAMES.verification, {
      to: 'owner@example.test',
      subject: 'Verify email',
      text: 'Verify email',
      html: '<p>Verify email</p>',
    });

    await vi.waitUntil(async () => (await queue.counts()).failed === 1, { timeout: 5_000 });

    expect(delivery.deliver).toHaveBeenCalledTimes(5);
    expect(await queue.counts()).toMatchObject({ failed: 1, waiting: 0, active: 0 });

    await worker.onModuleDestroy();
    await admin.obliterate({ force: true });
  });
});
