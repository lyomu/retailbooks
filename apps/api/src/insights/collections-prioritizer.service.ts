import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface CollectionsCandidate {
  readonly invoiceId: string;
  readonly invoiceNumber: string | null;
  readonly customerName: string;
  readonly balanceMinor: string;
  readonly daysOverdue: number;
  readonly exposureScore: number;
  readonly suggestedAction: string;
}

const MAX_RESULTS = 25;

/**
 * Deterministic collections ranking: exposure = balance x days overdue, both real, already-recorded
 * values. Suggests a next *review* action only ("send a reminder" / "escalate") -- never sends
 * anything itself; a reminder still goes through the existing Reminders feature.
 */
@Injectable()
export class CollectionsPrioritizerService {
  constructor(private readonly prisma: PrismaService) {}

  async rank(organizationId: string): Promise<CollectionsCandidate[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        invoiceNumber: string | null;
        customerName: string;
        balanceMinor: bigint;
        daysOverdue: number;
      }[]
    >(Prisma.sql`
      SELECT i.id, i.invoice_number AS "invoiceNumber", c.display_name AS "customerName",
             i.balance_minor AS "balanceMinor",
             GREATEST(0, CURRENT_DATE - i.due_date) AS "daysOverdue"
      FROM invoices i
      JOIN contacts c ON c.id = i.contact_id AND c.organization_id = ${organizationId}::uuid
      WHERE i.organization_id = ${organizationId}::uuid
        AND i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND i.balance_minor <> 0
        AND i.due_date < CURRENT_DATE
      ORDER BY i.due_date
    `);

    return rows
      .map((row) => {
        const exposureScore = Number(row.balanceMinor) * row.daysOverdue;
        return {
          invoiceId: row.id,
          invoiceNumber: row.invoiceNumber,
          customerName: row.customerName,
          balanceMinor: row.balanceMinor.toString(),
          daysOverdue: row.daysOverdue,
          exposureScore,
          suggestedAction: suggestAction(row.daysOverdue),
        };
      })
      .sort((a, b) => b.exposureScore - a.exposureScore)
      .slice(0, MAX_RESULTS);
  }
}

function suggestAction(daysOverdue: number): string {
  if (daysOverdue >= 60) return 'Escalate: consider a formal collections process.';
  if (daysOverdue >= 30) return 'Follow up directly; a standard reminder has likely already run.';
  return 'Send a payment reminder.';
}
