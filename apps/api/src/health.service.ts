import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthResponse, QueueStatus, ServiceStatus } from '@retailbooks/contracts';
import { DomainEventState } from '@prisma/client';
import { Client as PostgresClient } from 'pg';
import { createClient as createRedisClient } from 'redis';

import { AUTOMATION_QUEUE_NAME } from './automation/automation-job.js';
import { AutomationQueueService } from './automation/automation-queue.service.js';
import { PrismaService } from './database/prisma.service.js';
import { EMAIL_QUEUE_NAME } from './jobs/email-job.js';
import { EmailQueueService } from './jobs/email-queue.service.js';

const version = process.env.npm_package_version ?? '0.1.0';

/** An outbox row pending this long without being dispatched suggests no worker is draining it. */
const OUTBOX_STALE_MS = 5 * 60 * 1_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly emailQueue: EmailQueueService,
    private readonly automationQueue: AutomationQueueService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  liveness(): HealthResponse {
    return {
      status: 'ok',
      service: 'retailbooks-api',
      version,
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<HealthResponse> {
    const [postgres, redis, minio, emailQueue, automationQueue, outbox] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMinio(),
      this.checkEmailQueue(),
      this.checkAutomationQueue(),
      this.checkDomainEventOutbox(),
    ]);
    const dependencies = [
      postgres,
      redis,
      minio,
      emailQueue.dependency,
      automationQueue.dependency,
      outbox,
    ];
    const queues = [emailQueue.queue, automationQueue.queue];

    return {
      ...this.liveness(),
      status:
        dependencies.every((dependency) => dependency.status === 'up') &&
        queues.every((queue) => queue.status === 'up')
          ? 'ok'
          : 'degraded',
      dependencies,
      queues,
    };
  }

  private async checkEmailQueue(): Promise<{ dependency: ServiceStatus; queue: QueueStatus }> {
    const startedAt = performance.now();
    try {
      const counts = await this.emailQueue.counts();
      const depth = counts.waiting + counts.active + counts.delayed;
      return {
        dependency: {
          name: EMAIL_QUEUE_NAME,
          status: 'up',
          latencyMs: Math.round(performance.now() - startedAt),
        },
        queue: {
          name: EMAIL_QUEUE_NAME,
          status: counts.failed > 0 ? 'degraded' : 'up',
          depth,
          ...counts,
        },
      };
    } catch {
      return {
        dependency: {
          name: EMAIL_QUEUE_NAME,
          status: 'down',
          latencyMs: Math.round(performance.now() - startedAt),
        },
        queue: {
          name: EMAIL_QUEUE_NAME,
          status: 'down',
          depth: 0,
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
        },
      };
    }
  }

  private async checkAutomationQueue(): Promise<{ dependency: ServiceStatus; queue: QueueStatus }> {
    const startedAt = performance.now();
    try {
      const counts = await this.automationQueue.counts();
      const depth = counts.waiting + counts.active + counts.delayed;
      return {
        dependency: {
          name: AUTOMATION_QUEUE_NAME,
          status: 'up',
          latencyMs: Math.round(performance.now() - startedAt),
        },
        queue: {
          name: AUTOMATION_QUEUE_NAME,
          status: counts.failed > 0 ? 'degraded' : 'up',
          depth,
          ...counts,
        },
      };
    } catch {
      return {
        dependency: {
          name: AUTOMATION_QUEUE_NAME,
          status: 'down',
          latencyMs: Math.round(performance.now() - startedAt),
        },
        queue: {
          name: AUTOMATION_QUEUE_NAME,
          status: 'down',
          depth: 0,
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
        },
      };
    }
  }

  /**
   * Aggregate-only: reports how stale the oldest pending row is, never per-organization rows or
   * payloads, so an unauthenticated readiness probe cannot leak cross-tenant job data. A backlog
   * older than `OUTBOX_STALE_MS` reads as `down` -- the most direct unauthenticated signal available
   * that no worker is draining the outbox, since workers do not publish an explicit heartbeat.
   */
  private async checkDomainEventOutbox(): Promise<ServiceStatus> {
    const startedAt = performance.now();
    try {
      const oldest = await this.prisma.domainEventOutbox.findFirst({
        where: { state: DomainEventState.PENDING },
        orderBy: { availableAt: 'asc' },
        select: { availableAt: true },
      });
      const ageMs = oldest ? Date.now() - oldest.availableAt.getTime() : 0;
      return {
        name: 'domain-event-outbox',
        status: ageMs > OUTBOX_STALE_MS ? 'down' : 'up',
        latencyMs: Math.round(performance.now() - startedAt),
        ageMs,
      };
    } catch {
      return {
        name: 'domain-event-outbox',
        status: 'down',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  }

  private async checkPostgres(): Promise<ServiceStatus> {
    return this.timedCheck('postgres', async () => {
      const client = new PostgresClient({
        connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
        connectionTimeoutMillis: 1_500,
      });

      try {
        await client.connect();
        await client.query('select 1');
      } finally {
        await client.end().catch(() => undefined);
      }
    });
  }

  private async checkRedis(): Promise<ServiceStatus> {
    return this.timedCheck('redis', async () => {
      const client = createRedisClient({
        url: this.config.getOrThrow<string>('REDIS_URL'),
        socket: { connectTimeout: 1_500 },
      });
      client.on('error', () => undefined);

      try {
        await client.connect();
        await client.ping();
      } finally {
        if (client.isOpen) await client.quit();
      }
    });
  }

  private async checkMinio(): Promise<ServiceStatus> {
    return this.timedCheck('minio', async () => {
      const endpoint = this.config.getOrThrow<string>('S3_ENDPOINT');
      const response = await fetch(`${endpoint}/minio/health/live`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) throw new Error(`MinIO returned ${response.status}`);
    });
  }

  private async timedCheck(name: string, check: () => Promise<void>): Promise<ServiceStatus> {
    const startedAt = performance.now();
    try {
      await check();
      return { name, status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
    } catch {
      return { name, status: 'down', latencyMs: Math.round(performance.now() - startedAt) };
    }
  }
}
