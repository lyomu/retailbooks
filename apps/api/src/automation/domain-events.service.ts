import { Inject, Injectable } from '@nestjs/common';
import { DomainEventState, type Prisma } from '@prisma/client';
import { DOMAIN_EVENT_NAMES, type DomainEventName } from '@retailbooks/contracts';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../database/prisma.service.js';
import { CLOCK, type Clock } from './clock.js';

/** Backoff after a dispatch failure: doubles per attempt, capped at 5 minutes. */
const OUTBOX_BASE_RETRY_MS = 1_000;
const OUTBOX_MAX_RETRY_MS = 5 * 60_000;

export { DOMAIN_EVENT_NAMES, type DomainEventName };

export type DomainEventInput = {
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  eventName: DomainEventName;
  payload?: Prisma.InputJsonValue;
  causationId?: string;
  correlationId?: string;
};

/**
 * Writes a durable event in the caller's transaction. Consumers receive only committed events;
 * `AuditEvent` intentionally remains a separate, immutable evidence stream.
 */
@Injectable()
export class DomainEventsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async emit(tx: Prisma.TransactionClient, event: DomainEventInput): Promise<string> {
    const created = await tx.domainEventOutbox.create({
      data: {
        organizationId: event.organizationId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventName: event.eventName,
        payload: event.payload ?? {},
        causationId: event.causationId,
        correlationId: event.correlationId,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Claims a short lease using per-event transaction advisory locks. */
  async claimBatch(limit = 50, leaseSeconds = 60) {
    const now = this.clock.now();
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.domainEventOutbox.findMany({
        where: {
          state: DomainEventState.PENDING,
          availableAt: { lte: now },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true },
      });
      const claimed: string[] = [];
      for (const candidate of candidates) {
        const lock = await tx.$queryRaw<Array<{ claimed: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${`domain-event:${candidate.id}`}, 0)) AS claimed
        `;
        if (!lock[0]?.claimed) continue;
        const leaseToken = randomUUID();
        const updated = await tx.domainEventOutbox.updateMany({
          where: {
            id: candidate.id,
            state: DomainEventState.PENDING,
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
          },
          data: {
            leasedAt: now,
            leaseToken,
            leaseExpiresAt,
            attempts: { increment: 1 },
          },
        });
        if (updated.count) claimed.push(candidate.id);
      }
      if (!claimed.length) return [];
      return tx.domainEventOutbox.findMany({ where: { id: { in: claimed } } });
    });
  }

  async markDispatched(eventId: string): Promise<void> {
    await this.prisma.domainEventOutbox.update({
      where: { id: eventId },
      data: {
        state: DomainEventState.DISPATCHED,
        dispatchedAt: this.clock.now(),
        leasedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }

  /**
   * Releases a failed claim back to `PENDING`. The next `availableAt` backs off exponentially from
   * the row's own `attempts` (already incremented by the `claimBatch` that claimed it), so a
   * consistently failing event backs further off each cycle instead of being retried at the same
   * fixed interval forever.
   */
  async release(eventId: string, error: unknown): Promise<void> {
    const current = await this.prisma.domainEventOutbox.findUnique({
      where: { id: eventId },
      select: { attempts: true },
    });
    const delayMs = backoffDelayMs(current?.attempts ?? 1);
    await this.prisma.domainEventOutbox.update({
      where: { id: eventId },
      data: {
        availableAt: new Date(this.clock.now().getTime() + delayMs),
        leasedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError:
          error instanceof Error ? error.message.slice(0, 8_000) : String(error).slice(0, 8_000),
      },
    });
  }

  async findDispatched(eventId: string) {
    return this.prisma.domainEventOutbox.findFirst({
      where: { id: eventId, state: DomainEventState.DISPATCHED },
    });
  }
}

function backoffDelayMs(attempts: number): number {
  const exponent = Math.max(attempts - 1, 0);
  return Math.min(OUTBOX_BASE_RETRY_MS * 2 ** exponent, OUTBOX_MAX_RETRY_MS);
}
