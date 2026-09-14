import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { producerConnection } from '../jobs/redis-connection.js';
import {
  DOCUMENT_EXTRACTION_JOB_NAMES,
  DOCUMENT_EXTRACTION_QUEUE_NAME,
  type DocumentExtractionJob,
  type DocumentExtractionJobName,
  type ExtractionJob,
} from './document-extraction-job.js';

/**
 * A separate queue from `automation` on purpose: this one carries untrusted document bytes through
 * a malware scan and local OCR, a different trust boundary from internal domain events/schedules.
 */
@Injectable()
export class DocumentExtractionQueueService implements OnModuleDestroy {
  private readonly queue: Queue<DocumentExtractionJob, void, DocumentExtractionJobName>;

  constructor(config: ConfigService) {
    this.queue = new Queue<DocumentExtractionJob, void, DocumentExtractionJobName>(
      DOCUMENT_EXTRACTION_QUEUE_NAME,
      {
        connection: producerConnection(config.getOrThrow<string>('REDIS_URL')),
        prefix: config.get<string>('QUEUE_PREFIX') ?? 'retailbooks',
        skipWaitingForReady: true,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: Number(config.get('DOCUMENT_EXTRACTION_RETRY_DELAY_MS') ?? 2_000),
          },
          removeOnComplete: { age: 3_600, count: 5_000 },
          removeOnFail: false,
        },
      },
    );
  }

  /** Deterministic jobId: re-enqueuing the same attachment (e.g. a retry after a transient scanner
   * outage) dedupes against any still-pending job instead of creating a duplicate worker run. */
  async enqueue(attachmentId: string): Promise<void> {
    const job: ExtractionJob = { attachmentId };
    await this.queue.add(DOCUMENT_EXTRACTION_JOB_NAMES.extract, job, {
      jobId: `extraction-${attachmentId}`,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
