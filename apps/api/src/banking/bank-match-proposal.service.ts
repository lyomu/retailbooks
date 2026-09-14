import { Injectable, NotFoundException } from '@nestjs/common';
import type { MatchTargetType } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface MatchCandidate {
  readonly targetType: MatchTargetType;
  readonly targetId: string;
  readonly label: string;
  readonly amountMinor: string;
  readonly date: string;
  readonly score: number;
  readonly reason: string;
}

const WINDOW_DAYS = 10;
const MAX_CANDIDATES = 10;

/**
 * Deterministic bank-match ranking: every candidate below already has the *exact* bank-transaction
 * amount (the query filters on it), so this only ranks by date proximity and a description/label
 * text hit -- no model call. The user still confirms through the existing
 * `POST :bankTransactionId/match` route, which independently re-validates amount/direction; this
 * service never creates a `Match` itself.
 */
@Injectable()
export class BankMatchProposalService {
  constructor(private readonly prisma: PrismaService) {}

  async propose(organizationId: string, bankTransactionId: string): Promise<MatchCandidate[]> {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id: bankTransactionId, organizationId },
    });
    if (!transaction) throw new NotFoundException('Bank transaction not found.');
    if (transaction.disposition !== 'UNRESOLVED') return [];

    const from = addDays(transaction.transactionDate, -WINDOW_DAYS);
    const to = addDays(transaction.transactionDate, WINDOW_DAYS);
    const candidates: MatchCandidate[] = [];

    if (transaction.direction === 'INFLOW') {
      const payments = await this.prisma.paymentReceived.findMany({
        where: {
          organizationId,
          amountMinor: transaction.amountMinor,
          receivedDate: { gte: from, lte: to },
        },
        include: { contact: { select: { displayName: true } } },
      });
      for (const payment of payments) {
        candidates.push(
          this.score(
            'PAYMENT_RECEIVED',
            payment.id,
            payment.contact.displayName,
            payment.amountMinor,
            payment.receivedDate,
            transaction,
          ),
        );
      }
    } else {
      const payments = await this.prisma.paymentMade.findMany({
        where: {
          organizationId,
          amountMinor: transaction.amountMinor,
          paidDate: { gte: from, lte: to },
        },
        include: { vendor: { select: { displayName: true } } },
      });
      for (const payment of payments) {
        candidates.push(
          this.score(
            'PAYMENT_MADE',
            payment.id,
            payment.vendor.displayName,
            payment.amountMinor,
            payment.paidDate,
            transaction,
          ),
        );
      }

      const expenses = await this.prisma.expense.findMany({
        where: {
          organizationId,
          status: 'POSTED',
          totalMinor: transaction.amountMinor,
          expenseDate: { gte: from, lte: to },
        },
        include: { payeeVendor: { select: { displayName: true } } },
      });
      for (const expense of expenses) {
        candidates.push(
          this.score(
            'EXPENSE',
            expense.id,
            expense.payeeVendor?.displayName ?? expense.payeeName ?? 'Expense',
            expense.totalMinor,
            expense.expenseDate,
            transaction,
          ),
        );
      }
    }

    const transfers = await this.prisma.transfer.findMany({
      where: {
        organizationId,
        voidedAt: null,
        transferDate: { gte: from, lte: to },
        ...(transaction.direction === 'INFLOW'
          ? { toAmountMinor: transaction.amountMinor }
          : { fromAmountMinor: transaction.amountMinor }),
      },
    });
    for (const transfer of transfers) {
      candidates.push(
        this.score(
          'TRANSFER',
          transfer.id,
          transfer.description ?? 'Transfer',
          transaction.direction === 'INFLOW' ? transfer.toAmountMinor : transfer.fromAmountMinor,
          transfer.transferDate,
          transaction,
        ),
      );
    }

    if (candidates.length === 0) return [];

    const claimed = await this.prisma.match.findMany({
      where: {
        organizationId,
        OR: candidates.map((candidate) => ({
          targetType: candidate.targetType,
          targetId: candidate.targetId,
        })),
      },
      select: { targetType: true, targetId: true },
    });
    const claimedKeys = new Set(claimed.map((match) => `${match.targetType}:${match.targetId}`));

    return candidates
      .filter((candidate) => !claimedKeys.has(`${candidate.targetType}:${candidate.targetId}`))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES);
  }

  private score(
    targetType: MatchTargetType,
    targetId: string,
    label: string,
    amountMinor: bigint,
    date: Date,
    transaction: { transactionDate: Date; description: string },
  ): MatchCandidate {
    const dayDiff = Math.abs(
      Math.round((date.getTime() - transaction.transactionDate.getTime()) / 86_400_000),
    );
    const descriptionMatch =
      label.length > 0 && transaction.description.toLowerCase().includes(label.toLowerCase());
    let score = 100 - dayDiff * 2;
    if (descriptionMatch) score += 20;

    const reasonParts = ['exact amount match', `${dayDiff} day(s) from the bank transaction date`];
    if (descriptionMatch) reasonParts.push(`"${label}" appears in the transaction description`);

    return {
      targetType,
      targetId,
      label,
      amountMinor: amountMinor.toString(),
      date: date.toISOString().slice(0, 10),
      score,
      reason: reasonParts.join(', '),
    };
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
