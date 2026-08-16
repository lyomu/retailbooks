import { Injectable } from '@nestjs/common';
import type { HealthResponse, ServiceStatus } from '@retailbooks/contracts';
import { Client as PostgresClient } from 'pg';
import { createClient as createRedisClient } from 'redis';

const version = process.env.npm_package_version ?? '0.1.0';

@Injectable()
export class HealthService {
  liveness(): HealthResponse {
    return {
      status: 'ok',
      service: 'retailbooks-api',
      version,
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<HealthResponse> {
    const dependencies = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMinio(),
    ]);

    return {
      ...this.liveness(),
      status: dependencies.every((dependency) => dependency.status === 'up') ? 'ok' : 'degraded',
      dependencies,
    };
  }

  private async checkPostgres(): Promise<ServiceStatus> {
    return this.timedCheck('postgres', async () => {
      const client = new PostgresClient({
        connectionString:
          process.env.DATABASE_URL ??
          'postgresql://retailbooks:retailbooks@localhost:55432/retailbooks',
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
        url: process.env.REDIS_URL ?? 'redis://localhost:56379',
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
      const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:59000';
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
