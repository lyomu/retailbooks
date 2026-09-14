import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { AiStore } from './ai.store.js';

const ORGANIZATION_BATCH_SIZE = 100;

/** Deletes expired AI metadata and cascaded evidence while preserving the independent audit event. */
@Injectable()
export class AiRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiRetentionService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: AiStore,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = this.config.getOrThrow<number>('AI_RETENTION_POLL_MS');
    this.timer = setInterval(() => void this.run(), interval);
    void this.run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async pruneExpired(): Promise<number> {
    const before = new Date(
      Date.now() - this.config.getOrThrow<number>('AI_RUN_RETENTION_DAYS') * 86_400_000,
    );
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const organizations = await this.prisma.organization.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        take: ORGANIZATION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const organization of organizations) {
        deleted += await this.store.purgeExpired(organization.id, before);
      }
      cursor = organizations.at(-1)?.id;
      if (organizations.length < ORGANIZATION_BATCH_SIZE) break;
    } while (cursor);

    return deleted;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deleted = await this.pruneExpired();
      if (deleted > 0) this.logger.log(`Deleted ${deleted} expired AI run records.`);
    } catch (error) {
      this.logger.error({ message: 'AI retention sweep failed', error });
    } finally {
      this.running = false;
    }
  }
}
