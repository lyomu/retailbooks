import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { decodeCursor, encodeCursor } from './audit-log-cursor.js';
import type { AuditLogQueryDto } from './audit-log.dto.js';

const DEFAULT_LIMIT = 50;

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: AuditLogQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;

    const where: Prisma.SecurityEventWhereInput = { organizationId };
    if (query.eventKey) where.eventKey = { startsWith: query.eventKey };
    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.cursor) {
      const cursor = this.parseCursor(query.cursor);
      where.OR = [
        { occurredAt: { lt: cursor.occurredAt } },
        { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await this.prisma.securityEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      events: page.map((row) => ({
        id: row.id,
        eventKey: row.eventKey,
        severity: row.severity,
        occurredAt: row.occurredAt.toISOString(),
        ipHash: row.ipHash,
        actor: row.user
          ? { id: row.user.id, displayName: row.user.displayName, email: row.user.email }
          : null,
        metadata: row.metadata,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ occurredAt: last.occurredAt.toISOString(), id: last.id })
          : null,
    };
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
