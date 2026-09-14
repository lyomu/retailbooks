import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';

export interface CloseChecklist {
  readonly unreconciledAccounts: {
    financialAccountId: string;
    accountName: string;
    lastCompletedAt: string | null;
  }[];
  readonly pendingApprovals: number;
  readonly missingDocumentExpenses: {
    id: string;
    expenseNumber: string | null;
    amountMinor: string;
  }[];
  readonly unresolvedBankTransactions: number;
  readonly staleDraftCount: number;
}

const STALE_RECONCILIATION_DAYS = 35;
const STALE_DRAFT_DAYS = 14;

/**
 * Deterministic month-end close checklist: no model call, just a read-only aggregation across
 * banking, approvals, and attachments -- every item links back to its existing screen, and nothing
 * here mutates anything.
 */
@Injectable()
export class CloseChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  async build(organizationId: string): Promise<CloseChecklist> {
    const now = new Date();
    const staleReconciliationCutoff = addDays(now, -STALE_RECONCILIATION_DAYS);
    const staleDraftCutoff = addDays(now, -STALE_DRAFT_DAYS);

    const accounts = await this.prisma.financialAccount.findMany({
      where: { organizationId, active: true },
      select: {
        id: true,
        name: true,
        reconciliations: {
          where: { status: 'COMPLETED' },
          orderBy: { statementEndDate: 'desc' },
          take: 1,
          select: { statementEndDate: true },
        },
      },
    });
    const unreconciledAccounts = accounts
      .filter((account) => {
        const lastCompleted = account.reconciliations[0]?.statementEndDate;
        return !lastCompleted || lastCompleted < staleReconciliationCutoff;
      })
      .map((account) => ({
        financialAccountId: account.id,
        accountName: account.name,
        lastCompletedAt:
          account.reconciliations[0]?.statementEndDate?.toISOString().slice(0, 10) ?? null,
      }));

    const [
      postedExpenses,
      pendingApprovals,
      unresolvedBankTransactions,
      staleDraftExpenses,
      staleDraftBills,
    ] = await Promise.all([
      this.prisma.expense.findMany({
        where: { organizationId, status: 'POSTED' },
        select: { id: true, expenseNumber: true, totalMinor: true },
      }),
      this.prisma.approvalRequest.count({ where: { organizationId, status: 'PENDING' } }),
      this.prisma.bankTransaction.count({ where: { organizationId, disposition: 'UNRESOLVED' } }),
      this.prisma.expense.count({
        where: { organizationId, status: 'DRAFT', createdAt: { lt: staleDraftCutoff } },
      }),
      this.prisma.bill.count({
        where: { organizationId, status: 'DRAFT', createdAt: { lt: staleDraftCutoff } },
      }),
    ]);

    // Attachment is a generic polymorphic table (entityType/entityId), not a Prisma relation on
    // Expense, so "has no attachment" is a manual anti-join rather than a `{ none: {} }` filter.
    const attached = await this.prisma.attachment.findMany({
      where: {
        organizationId,
        entityType: 'EXPENSE',
        entityId: { in: postedExpenses.map((expense) => expense.id) },
      },
      select: { entityId: true },
      distinct: ['entityId'],
    });
    const attachedIds = new Set(attached.map((attachment) => attachment.entityId));
    const missingDocumentExpenses = postedExpenses
      .filter((expense) => !attachedIds.has(expense.id))
      .slice(0, 25)
      .map((expense) => ({
        id: expense.id,
        expenseNumber: expense.expenseNumber,
        amountMinor: expense.totalMinor.toString(),
      }));

    return {
      unreconciledAccounts,
      pendingApprovals,
      missingDocumentExpenses,
      unresolvedBankTransactions,
      staleDraftCount: staleDraftExpenses + staleDraftBills,
    };
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
