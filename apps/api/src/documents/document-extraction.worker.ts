import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';

import { workerConnection } from '../jobs/redis-connection.js';
import {
  DOCUMENT_EXTRACTION_JOB_NAMES,
  DOCUMENT_EXTRACTION_QUEUE_NAME,
  type DocumentExtractionJob,
  type DocumentExtractionJobName,
} from './document-extraction-job.js';
import { DocumentExtractionService } from './document-extraction.service.js';

@Injectable()
export class DocumentExtractionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentExtractionWorker.name);
  private worker?: Worker<DocumentExtractionJob, void, DocumentExtractionJobName>;

  constructor(
    private readonly config: ConfigService,
    private readonly extraction: DocumentExtractionService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DocumentExtractionJob, void, DocumentExtractionJobName>(
      DOCUMENT_EXTRACTION_QUEUE_NAME,
      async (job) => this.process(job),
      {
        connection: workerConnection(this.config.getOrThrow<string>('REDIS_URL')),
        prefix: this.config.get<string>('QUEUE_PREFIX') ?? 'retailbooks',
        concurrency: Number(this.config.get('DOCUMENT_EXTRACTION_WORKER_CONCURRENCY') ?? 2),
        metrics: { maxDataPoints: 14 * 24 * 60 },
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error({
        message: 'Document extraction job failed',
        jobId: job?.id,
        name: job?.name,
        error,
      }),
    );
    this.worker.on('error', (error) =>
      this.logger.error({ message: 'Document extraction worker error', error }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<DocumentExtractionJob, void, DocumentExtractionJobName>) {
    if (job.name === DOCUMENT_EXTRACTION_JOB_NAMES.extract) {
      await this.extraction.process(job.data.attachmentId);
      return;
    }
    const neverName: never = job.name;
    throw new Error(`Unknown document extraction job ${String(neverName)}`);
  }
}
