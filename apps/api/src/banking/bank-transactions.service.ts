import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, type MatchTargetType } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { PostingRulesService } from '../posting-rules/posting-rules.service.js';
import { BANK_TRANSACTION_CATEGORIZE_RULE } from './bank-transaction-posting-rule.js';
import type {
  CategorizeBankTransactionDto,
  MatchBankTransactionDto,
} from './bank-transactions.dto.js';

@Injectable()
export class BankTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: PostingRulesService,
  ) {}

  async list(organizationId: string, financialAccountId?: string, disposition?: string) {
    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        organizationId,
        ...(financialAccountId ? { financialAccountId } : {}),
        ...(disposition ? { disposition: disposition as never } : {}),
      },
      include: { match: true },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return transactions.map(summarize);
  }

  async detail(organizationId: string, bankTransactionId: string) {
    const transaction = await this.findOrThrow(organizationId, bankTransactionId);
    return summarize(transaction);
  }

  /**
   * Posts the transaction directly against the chart of accounts (single line = plain categorize,
   * multiple lines = split). Lines must sum to the transaction's own amount -- this is the only
   * ledger-posting path for a bank transaction; `match()` below links to a document that already
   * posted its own journal instead.
   */
  async categorize(
    context: OrganizationContext,
    user: PublicUser,
    bankTransactionId: string,
    input: CategorizeBankTransactionDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const totalLines = input.lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);

    const posted = await this.prisma.$transaction(async (tx) => {
      await this.lockTransactionIdempotency(tx, context.id, bankTransactionId, idempotencyKey);
      const existingResult = await this.findTransactionIdempotentResult(
        context.id,
        bankTransactionId,
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.bankTransaction.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: { match: true },
        });
      }

      const transaction = await tx.bankTransaction.findFirst({
        where: { id: bankTransactionId, organizationId: context.id },
        include: { financialAccount: true },
      });
      if (!transaction) throw new NotFoundException('Bank transaction not found.');
      if (transaction.disposition !== 'UNRESOLVED') {
        throw new ConflictException('Only unresolved transactions can be categorized.');
      }
      if (totalLines !== transaction.amountMinor) {
        throw new BadRequestException(
          "The category lines' total must equal the transaction's amount.",
        );
      }

      const postedJournal = await this.rules.post(
        context,
        user,
        BANK_TRANSACTION_CATEGORIZE_RULE,
        {
          sourceId: transaction.id,
          journalDate: transaction.transactionDate,
          currency: transaction.currency,
          description: transaction.description,
          direction: transaction.direction,
          financialAccountGlAccountId: transaction.financialAccount.glAccountId,
          totalMinor: transaction.amountMinor,
          categoryLines: input.lines.map((line) => ({
            accountId: line.accountId,
            amountMinor: BigInt(line.amountMinor),
            description: line.description,
          })),
        },
        metadata,
        undefined,
        tx,
      );

      const updated = await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { disposition: 'POSTED', postedJournalId: postedJournal.id },
        include: { match: true },
      });

      await tx.financialAccount.update({
        where: { id: transaction.financialAccountId },
        data: { lastActivityAt: new Date() },
      });

      await this.recordTransactionIdempotency(tx, context.id, bankTransactionId, idempotencyKey);
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.transaction_categorized',
        entityType: 'bank_transaction',
        entityId: bankTransactionId,
        action: AuditAction.UPDATE,
        after: { lineCount: input.lines.length, totalMinor: totalLines.toString() },
        ipHash: metadata.ipHash,
      });

      return updated;
    });

    return summarize(posted);
  }

  async exclude(
    context: OrganizationContext,
    user: PublicUser,
    bankTransactionId: string,
    reason: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, bankTransactionId);
    if (existing.disposition !== 'UNRESOLVED') {
      throw new ConflictException('Only unresolved transactions can be excluded.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { disposition: 'EXCLUDED', excludeReason: reason },
        include: { match: true },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.transaction_excluded',
        entityType: 'bank_transaction',
        entityId: bankTransactionId,
        action: AuditAction.UPDATE,
        after: { reason },
        ipHash: metadata.ipHash,
      });
      return transaction;
    });

    return summarize(updated);
  }

  /**
   * Links a bank transaction to an already-posted source document (a payment, an expense, or a
   * transfer) -- no new journal, the target already posted its own. The DB-level
   * `@@unique([targetType, targetId])` on `Match` is the actual invariant enforcement (one source
   * document claimed by at most one bank transaction); this method pre-checks for a clear error
   * message but the constraint is the real backstop against a race.
   */
  async match(
    context: OrganizationContext,
    user: PublicUser,
    bankTransactionId: string,
    input: MatchBankTransactionDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, bankTransactionId);
    if (existing.disposition !== 'UNRESOLVED') {
      throw new ConflictException('Only unresolved transactions can be matched.');
    }

    await this.assertTargetMatches(context.id, input.targetType, input.targetId, existing);

    const already = await this.prisma.match.findUnique({
      where: { targetType_targetId: { targetType: input.targetType, targetId: input.targetId } },
    });
    if (already) {
      throw new ConflictException('This document is already matched to another bank transaction.');
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.match.create({
          data: {
            organizationId: context.id,
            bankTransactionId,
            targetType: input.targetType,
            targetId: input.targetId,
            note: input.note ?? null,
            matchedByUserId: user.id,
          },
        });
        const transaction = await tx.bankTransaction.update({
          where: { id: bankTransactionId },
          data: { disposition: 'MATCHED' },
          include: { match: true },
        });
        await writeAuditEvent(tx, {
          organizationId: context.id,
          actorUserId: user.id,
          eventKey: 'banking.transaction_matched',
          entityType: 'bank_transaction',
          entityId: bankTransactionId,
          action: AuditAction.UPDATE,
          after: { targetType: input.targetType, targetId: input.targetId },
          ipHash: metadata.ipHash,
        });
        return transaction;
      });
      return summarize(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'This document is already matched to another bank transaction.',
        );
      }
      throw error;
    }
  }

  async unmatch(
    context: OrganizationContext,
    user: PublicUser,
    bankTransactionId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, bankTransactionId);
    if (existing.disposition !== 'MATCHED') {
      throw new ConflictException('Only matched transactions can be unmatched.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.match.delete({ where: { bankTransactionId } });
      const transaction = await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { disposition: 'UNRESOLVED' },
        include: { match: true },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.transaction_unmatched',
        entityType: 'bank_transaction',
        entityId: bankTransactionId,
        action: AuditAction.UPDATE,
        ipHash: metadata.ipHash,
      });
      return transaction;
    });

    return summarize(updated);
  }

  private async assertTargetMatches(
    organizationId: string,
    targetType: MatchTargetType,
    targetId: string,
    transaction: { amountMinor: bigint; direction: 'INFLOW' | 'OUTFLOW' },
  ): Promise<void> {
    if (targetType === 'PAYMENT_RECEIVED') {
      if (transaction.direction !== 'INFLOW') {
        throw new BadRequestException('A payment received must match an inflow transaction.');
      }
      const payment = await this.prisma.paymentReceived.findFirst({
        where: { id: targetId, organizationId },
      });
      if (!payment) throw new NotFoundException('Payment received not found.');
      if (payment.amountMinor !== transaction.amountMinor) {
        throw new BadRequestException("The payment's amount does not match this transaction.");
      }
      return;
    }
    if (targetType === 'PAYMENT_MADE') {
      if (transaction.direction !== 'OUTFLOW') {
        throw new BadRequestException('A payment made must match an outflow transaction.');
      }
      const payment = await this.prisma.paymentMade.findFirst({
        where: { id: targetId, organizationId },
      });
      if (!payment) throw new NotFoundException('Payment made not found.');
      if (payment.amountMinor !== transaction.amountMinor) {
        throw new BadRequestException("The payment's amount does not match this transaction.");
      }
      return;
    }
    if (targetType === 'EXPENSE') {
      if (transaction.direction !== 'OUTFLOW') {
        throw new BadRequestException('An expense must match an outflow transaction.');
      }
      const expense = await this.prisma.expense.findFirst({
        where: { id: targetId, organizationId },
      });
      if (!expense) throw new NotFoundException('Expense not found.');
      if (expense.status !== 'POSTED') {
        throw new BadRequestException('Only a posted expense can be matched.');
      }
      if (expense.totalMinor !== transaction.amountMinor) {
        throw new BadRequestException("The expense's amount does not match this transaction.");
      }
      return;
    }
    const transfer = await this.prisma.transfer.findFirst({
      where: { id: targetId, organizationId },
    });
    if (!transfer) throw new NotFoundException('Transfer not found.');
    if (transfer.status !== 'POSTED') {
      throw new BadRequestException('Only a posted transfer can be matched.');
    }
    const matchesLeg =
      transfer.fromAmountMinor === transaction.amountMinor ||
      transfer.toAmountMinor === transaction.amountMinor;
    if (!matchesLeg) {
      throw new BadRequestException(
        "Neither of the transfer's leg amounts match this transaction.",
      );
    }
  }

  private async findOrThrow(organizationId: string, bankTransactionId: string) {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id: bankTransactionId, organizationId },
      include: { match: true },
    });
    if (!transaction) throw new NotFoundException('Bank transaction not found.');
    return transaction;
  }

  private async lockTransactionIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    bankTransactionId: string,
    key?: string,
  ): Promise<void> {
    if (!key) return;
    const lockKey = `${organizationId}:BANK_TXN_CATEGORIZE:${bankTransactionId}:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private async findTransactionIdempotentResult(
    organizationId: string,
    bankTransactionId: string,
    key: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return tx.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: {
          organizationId,
          operation: 'BANK_TXN_CATEGORIZE_TRANSACTION',
          key: `${bankTransactionId}:${key}`,
        },
      },
      select: { resourceId: true },
    });
  }

  private recordTransactionIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    bankTransactionId: string,
    key: string | undefined,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation: 'BANK_TXN_CATEGORIZE_TRANSACTION',
        key: `${bankTransactionId}:${key}`,
        resourceType: 'BANK_TRANSACTION',
        resourceId: bankTransactionId,
      },
    });
  }
}

function summarize(transaction: {
  id: string;
  financialAccountId: string;
  statementImportId: string | null;
  transactionDate: Date;
  description: string;
  reference: string | null;
  direction: string;
  amountMinor: bigint;
  currency: string;
  disposition: string;
  excludeReason: string | null;
  suggestedAccountId: string | null;
  suggestedContactId: string | null;
  suggestedVendorId: string | null;
  suggestedTags: string[];
  appliedFromRuleId: string | null;
  postedJournalId: string | null;
  match: {
    id: string;
    targetType: string;
    targetId: string;
    note: string | null;
    createdAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: transaction.id,
    financialAccountId: transaction.financialAccountId,
    statementImportId: transaction.statementImportId,
    transactionDate: dateOnly(transaction.transactionDate),
    description: transaction.description,
    reference: transaction.reference,
    direction: transaction.direction,
    amountMinor: transaction.amountMinor.toString(),
    currency: transaction.currency,
    disposition: transaction.disposition,
    excludeReason: transaction.excludeReason,
    suggestedAccountId: transaction.suggestedAccountId,
    suggestedContactId: transaction.suggestedContactId,
    suggestedVendorId: transaction.suggestedVendorId,
    suggestedTags: transaction.suggestedTags,
    appliedFromRuleId: transaction.appliedFromRuleId,
    postedJournalId: transaction.postedJournalId,
    match: transaction.match
      ? {
          id: transaction.match.id,
          targetType: transaction.match.targetType,
          targetId: transaction.match.targetId,
          note: transaction.match.note,
          createdAt: transaction.match.createdAt.toISOString(),
        }
      : null,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
