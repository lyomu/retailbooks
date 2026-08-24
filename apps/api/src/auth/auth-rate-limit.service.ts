import { HttpException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

interface LocalCounter {
  count: number;
  expiresAt: number;
}

@Injectable()
export class AuthRateLimitService implements OnModuleDestroy {
  private readonly client: RedisClientType;
  private readonly localCounters = new Map<string, LocalCounter>();

  constructor(config: ConfigService) {
    this.client = createClient({
      url: config.get('REDIS_URL') ?? 'redis://localhost:56379',
      socket: { connectTimeout: 750, reconnectStrategy: false },
    });
    this.client.on('error', () => undefined);
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    try {
      if (!this.client.isOpen) await this.client.connect();
      const count = await this.client.incr(key);
      if (count === 1) await this.client.expire(key, windowSeconds);
      if (count > limit) throw new HttpException('Too many attempts. Try again later.', 429);
      return;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.consumeLocally(key, limit, windowSeconds);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  private consumeLocally(key: string, limit: number, windowSeconds: number): void {
    const now = Date.now();
    const current = this.localCounters.get(key);
    const counter =
      !current || current.expiresAt <= now
        ? { count: 1, expiresAt: now + windowSeconds * 1000 }
        : { ...current, count: current.count + 1 };

    this.localCounters.set(key, counter);
    if (counter.count > limit) throw new HttpException('Too many attempts. Try again later.', 429);

    if (this.localCounters.size > 10_000) {
      for (const [counterKey, value] of this.localCounters) {
        if (value.expiresAt <= now) this.localCounters.delete(counterKey);
      }
    }
  }
}
