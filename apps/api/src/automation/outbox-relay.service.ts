import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AutomationQueueService } from './automation-queue.service.js';
import { CLOCK, type Clock } from './clock.js';
import { DomainEventsService } from './domain-events.service.js';

/** Moves committed outbox rows into BullMQ. It deliberately runs only in the worker process. */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly config: ConfigService,
    private readonly events: DomainEventsService,
    private readonly queue: AutomationQueueService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(this.config.get('AUTOMATION_OUTBOX_POLL_MS') ?? 1_000);
    this.timer = setInterval(() => void this.drain(), intervalMs);
    void this.drain();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    const startedAt = this.clock.now().getTime();
    let dispatched = 0;
    let failed = 0;
    try {
      const events = await this.events.claimBatch();
      for (const event of events) {
        try {
          await this.queue.enqueueDomainEvent(event.id);
          await this.events.markDispatched(event.id);
          dispatched += 1;
        } catch (error) {
          await this.events.release(event.id, error);
          failed += 1;
          this.logger.warn({
            message: 'Outbox dispatch failed; event lease released',
            eventId: event.id,
            error,
          });
        }
      }
      // Only logged when there was something to do -- an idle poll every second would otherwise
      // flood the log at rest. A log aggregator can still build a dispatched/failed rate off this.
      if (events.length) {
        this.logger.log({
          message: 'Outbox drain cycle completed',
          claimed: events.length,
          dispatched,
          failed,
          durationMs: this.clock.now().getTime() - startedAt,
        });
      }
    } finally {
      this.draining = false;
    }
  }
}
