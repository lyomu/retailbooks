import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SchedulerService } from './scheduler.service.js';

@Injectable()
export class SchedulerPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerPollerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    const interval = Number(this.config.get('AUTOMATION_SCHEDULER_POLL_MS') ?? 30_000);
    this.timer = setInterval(() => void this.tick(), interval);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.scheduler.replayQueued();
      await this.scheduler.sweep();
    } catch (error) {
      this.logger.error({ message: 'Automation scheduler sweep failed', error });
    } finally {
      this.running = false;
    }
  }
}
