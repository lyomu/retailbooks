import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { decodeCursor, encodeCursor } from './audit-log-cursor.js';
import type { AuditLogQueryDto } from './audit-log.dto.js';

const DEFAULT_LIMIT = 50;
const EXPORT_LIMIT = 10_000;

export type AuditLogSource = 'audit' | 'security';

export interface AuditLogEntry {
  id: string;
  source: AuditLogSource;
  eventKey: string;
  occurredAt: string;
  severity: string | null;
  ipHash: string | null;
  actor: { id: string; displayName: string; email: string } | null;
  entityType: string | null;
  entityId: string | null;
  action: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
}

const actorSelect = { select: { id: true, displayName: true, email: true } } as const;

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads both audit streams as one chronological log.
   *
   * `audit_events` records what changed (with before/after values); `security_events` records
   * security-relevant signals. Each table is queried for `limit + 1` rows under the same keyset
   * predicate and merged in memory. That is correct because any row not fetched from a table is
   * strictly older than every row that was, so the merged head is the true head.
   */
  async list(organizationId: string, query: AuditLogQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const entries = await this.read(organizationId, query, limit + 1);

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const last = page.at(-1);

    return {
      events: page,
      nextCursor:
        hasMore && last ? encodeCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
    };
  }

  /** Flattens the same view to CSV. Capped rather than streamed; unbounded export is a later need. */
  async exportCsv(organizationId: string, query: AuditLogQueryDto): Promise<string> {
    const entries = await this.read(organizationId, query, EXPORT_LIMIT);
    const header = [
      'occurred_at',
      'source',
      'event_key',
      'action',
      'entity_type',
      'entity_id',
      'actor_email',
      'actor_name',
      'before',
      'after',
    ];

    const rows = entries.map((entry) => [
      entry.occurredAt,
      entry.source,
      entry.eventKey,
      entry.action ?? '',
      entry.entityType ?? '',
      entry.entityId ?? '',
      entry.actor?.email ?? '',
      entry.actor?.displayName ?? '',
      entry.before === null || entry.before === undefined ? '' : JSON.stringify(entry.before),
      entry.after === null || entry.after === undefined ? '' : JSON.stringify(entry.after),
    ]);

    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  private async read(
    organizationId: string,
    query: AuditLogQueryDto,
    take: number,
  ): Promise<AuditLogEntry[]> {
    const cursor = query.cursor ? this.parseCursor(query.cursor) : null;
    const source = query.source;

    const occurredAt =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          }
        : undefined;

    const keyset = cursor
      ? [
          { occurredAt: { lt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
        ]
      : undefined;

    const [auditRows, securityRows] = await Promise.all([
      source === 'security'
        ? Promise.resolve([])
        : this.prisma.auditEvent.findMany({
            where: {
              organizationId,
              ...(query.eventKey ? { eventKey: { startsWith: query.eventKey } } : {}),
              ...(occurredAt ? { occurredAt } : {}),
              ...(keyset ? { OR: keyset } : {}),
            },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take,
            include: { actor: actorSelect },
          }),
      source === 'audit'
        ? Promise.resolve([])
        : this.prisma.securityEvent.findMany({
            where: {
              organizationId,
              ...(query.eventKey ? { eventKey: { startsWith: query.eventKey } } : {}),
              ...(occurredAt ? { occurredAt } : {}),
              ...(keyset ? { OR: keyset } : {}),
            },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take,
            include: { user: actorSelect },
          }),
    ]);

    const merged: AuditLogEntry[] = [
      ...auditRows.map((row) => ({
        id: row.id,
        source: 'audit' as const,
        eventKey: row.eventKey,
        occurredAt: row.occurredAt.toISOString(),
        severity: null,
        ipHash: row.ipHash,
        actor: row.actor,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        before: row.before,
        after: row.after,
        metadata: row.metadata,
      })),
      ...securityRows.map((row) => ({
        id: row.id,
        source: 'security' as const,
        eventKey: row.eventKey,
        occurredAt: row.occurredAt.toISOString(),
        severity: row.severity,
        ipHash: row.ipHash,
        actor: row.user,
        entityType: null,
        entityId: null,
        action: null,
        before: null,
        after: null,
        metadata: row.metadata,
      })),
    ];

    merged.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    return merged.slice(0, take);
  }

  private parseCursor(value: string): { occurredAt: Date; id: string } {
    try {
      const decoded = decodeCursor(value);
      const occurredAt = new Date(decoded.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) throw new RangeError('Invalid cursor.');
      return { occurredAt, id: decoded.id };
    } catch {
      throw new BadRequestException('Invalid audit-log cursor.');
    }
  }
}

/** RFC 4180 quoting. Guards against a value containing a delimiter, quote, or newline. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
