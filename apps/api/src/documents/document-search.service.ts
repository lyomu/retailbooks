import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface DocumentSearchResult {
  readonly attachmentId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly filename: string;
  readonly snippet: string;
  readonly href: string;
}

const MAX_RESULTS = 25;

/**
 * PostgreSQL keyword retrieval over extracted receipt/bill text -- the required first fallback
 * before any embeddings/pgvector, which stay gated behind their own verified Postgres image and
 * migration path. Every query is filtered by organization, by only the entity types the caller's
 * own underlying domain permission allows, and by extraction status (only a completed, reviewed-
 * ready extraction is searchable) before any row is returned -- there is no path from a raw query
 * string to an unfiltered table scan.
 */
@Injectable()
export class DocumentSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    organizationId: string,
    query: string,
    allowedEntityTypes: readonly ('EXPENSE' | 'BILL')[],
  ): Promise<DocumentSearchResult[]> {
    const trimmed = query.trim();
    if (allowedEntityTypes.length === 0 || !trimmed) return [];

    const entityTypeFilter = Prisma.join(
      allowedEntityTypes.map((type) => Prisma.sql`${type}::"AttachmentEntityType"`),
    );

    const rows = await this.prisma.$queryRaw<
      {
        attachmentId: string;
        entityType: string;
        entityId: string;
        filename: string;
        snippet: string;
      }[]
    >(Prisma.sql`
      SELECT de.attachment_id AS "attachmentId", de.entity_type::text AS "entityType",
             de.entity_id::text AS "entityId", a.filename,
             ts_headline(
               'english', COALESCE(de.ocr_text, ''), plainto_tsquery('english', ${trimmed}),
               -- OCR text is untrusted, hostile-by-default input (never rendered as HTML, matching
               -- Phase 13D's "treat OCR output as hostile" rule); StartSel/StopSel are blanked so
               -- no markup at all comes back, not even a safe subset, for the caller to render.
               'MaxFragments=1, MaxWords=25, MinWords=10, StartSel=, StopSel='
             ) AS snippet
      FROM document_extractions de
      JOIN attachments a ON a.id = de.attachment_id AND a.organization_id = ${organizationId}::uuid
      WHERE de.organization_id = ${organizationId}::uuid
        AND de.status = 'READY_FOR_REVIEW'
        AND de.entity_type IN (${entityTypeFilter})
        AND de.search_tsv @@ plainto_tsquery('english', ${trimmed})
      ORDER BY ts_rank(de.search_tsv, plainto_tsquery('english', ${trimmed})) DESC
      LIMIT ${MAX_RESULTS}
    `);

    return rows.map((row) => ({
      ...row,
      href: row.entityType === 'EXPENSE' ? `/expenses/${row.entityId}` : `/bills/${row.entityId}`,
    }));
  }
}
