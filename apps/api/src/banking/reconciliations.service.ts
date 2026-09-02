import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type { SetClearedTransactionsDto, StartReconciliationDto } from './reconciliations.dto.js';

@Injectable()
export class ReconciliationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, financialAccountId?: string) {
    const reconciliations = await this.prisma.reconciliation.findMany({
      where: { organizationId, ...(financialAccountId ? { financialAccountId } : {}) },
      orderBy: [{ statementEndDate: 'desc' }],
      take: 200,
    });
    return reconciliations.map(summarize);
  }

  async detail(organizationId: string, reconciliationId: string) {
    const reconciliation = await this.findOrThrow(organizationId, reconciliationId);
    const cleared = await this.prisma.reconciliationClearedTransaction.findMany({
      where: { reconciliationId },
      include: { transaction: true },
    });
    return {
      ...summarize(reconciliation),
      difference: (await this.computeDifference(reconciliation)).toString(),
      clearedTransactionIds: cleared.map((row) => row.transactionId),
    };
  }

  async start(
    context: OrganizationContext,
    user: PublicUser,
    input: StartReconciliationDto,
    metadata: RequestMetadata,
  ) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id: input.financialAccountId, organizationId: context.id },
    });
    if (!account) throw new NotFoundException('Financial account not found.');

    const inProgress = await this.prisma.reconciliation.findFirst({
      where: { financialAccountId: input.financialAccountId, status: 'IN_PROGRESS' },
    });
    if (inProgress) {
      throw new ConflictException(
        'This account already has a reconciliation in progress; complete or reopen-and-cancel it first.',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const reconciliation = await tx.reconciliation.create({
        data: {
          organizationId: context.id,
          financialAccountId: input.financialAccountId,
          statementStartDate: isoDate(input.statementStartDate),
          statementEndDate: isoDate(input.statementEndDate),
          openingBalanceMinor: BigInt(input.openingBalanceMinor),
          closingBalanceMinor: BigInt(input.closingBalanceMinor),
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.reconciliation_started',
        entityType: 'reconciliation',
        entityId: reconciliation.id,
        action: AuditAction.CREATE,
        after: { financialAccountId: input.financialAccountId },
        ipHash: metadata.ipHash,
      });
      return reconciliation;
    });

    return summarize(created);
  }

  async setCleared(
    context: OrganizationContext,
    user: PublicUser,
    reconciliationId: string,
    input: SetClearedTransactionsDto,
    metadata: RequestMetadata,
    cleared: boolean,
  ) {
    const reconciliation = await this.findOrThrow(context.id, reconciliationId);
    if (reconciliation.status !== 'IN_PROGRESS') {
      throw new ConflictException(
        'Only an in-progress reconciliation can have transactions marked.',
      );
    }
    const transactions = await this.prisma.bankTransaction.findMany({
      where: {
        id: { in: input.transactionIds },
        organizationId: context.id,
        financialAccountId: reconciliation.financialAccountId,
      },
      select: { id: true },
    });
    if (transactions.length !== input.transactionIds.length) {
      throw new NotFoundException('One or more transactions were not found on this account.');
    }

    await this.prisma.$transaction(async (tx) => {
      if (cleared) {
        for (const transaction of transactions) {
          await tx.reconciliationClearedTransaction.upsert({
            where: {
              reconciliationId_transactionId: { reconciliationId, transactionId: transaction.id },
            },
            create: { reconciliationId, transactionId: transaction.id },
            update: {},
          });
        }
      } else {
        await tx.reconciliationClearedTransaction.deleteMany({
          where: { reconciliationId, transactionId: { in: input.transactionIds } },
        });
      }
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: cleared
          ? 'banking.reconciliation_transactions_cleared'
          : 'banking.reconciliation_transactions_uncleared',
        entityType: 'reconciliation',
        entityId: reconciliationId,
        action: AuditAction.UPDATE,
        after: { transactionIds: input.transactionIds },
        ipHash: metadata.ipHash,
      });
    });

    return this.detail(context.id, reconciliationId);
  }

  /** Completion requires the difference to be exactly zero -- no tolerance, no partial complete. */
  async complete(
    context: OrganizationContext,
    user: PublicUser,
    reconciliationId: string,
    metadata: RequestMetadata,
  ) {
    const reconciliation = await this.findOrThrow(context.id, reconciliationId);
    if (reconciliation.status !== 'IN_PROGRESS') {
      throw new ConflictException('Only an in-progress reconciliation can be completed.');
    }
    const difference = await this.computeDifference(reconciliation);
    if (difference !== 0n) {
      throw new ConflictException(
        `The reconciliation does not balance (difference: ${difference.toString()} minor units).`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.reconciliation.update({
        where: { id: reconciliationId },
        data: { status: 'COMPLETED', completedAt: new Date(), completedByUserId: user.id },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.reconciliation_completed',
        entityType: 'reconciliation',
        entityId: reconciliationId,
        action: AuditAction.UPDATE,
        before: { status: 'IN_PROGRESS' },
        after: { status: 'COMPLETED' },
        ipHash: metadata.ipHash,
      });
      return record;
    });

    return summarize(updated);
  }

  /** Requires an explicit reason -- recorded on the row and in the audit event, mirroring the
   * fiscal-period unlock pattern's insistence on an accountable reason for reopening a closed
   * period. */
  async reopen(
    context: OrganizationContext,
    user: PublicUser,
    reconciliationId: string,
    reason: string,
    metadata: RequestMetadata,
  ) {
    const reconciliation = await this.findOrThrow(context.id, reconciliationId);
    if (reconciliation.status !== 'COMPLETED') {
      throw new ConflictException('Only a completed reconciliation can be reopened.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.reconciliation.update({
        where: { id: reconciliationId },
        data: {
          status: 'IN_PROGRESS',
          reopenedAt: new Date(),
          reopenedByUserId: user.id,
          reopenReason: reason,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.reconciliation_reopened',
        entityType: 'reconciliation',
        entityId: reconciliationId,
        action: AuditAction.UPDATE,
        before: { status: 'COMPLETED' },
        after: { status: 'IN_PROGRESS', reason },
        ipHash: metadata.ipHash,
      });
      return record;
    });

    return summarize(updated);
  }

  private async computeDifference(reconciliation: {
    id: string;
    openingBalanceMinor: bigint;
    closingBalanceMinor: bigint;
  }): Promise<bigint> {
    const cleared = await this.prisma.reconciliationClearedTransaction.findMany({
      where: { reconciliationId: reconciliation.id },
      include: { transaction: { select: { amountMinor: true, direction: true } } },
    });
    const runningBalance = cleared.reduce(
      (sum, row) =>
        sum +
        (row.transaction.direction === 'INFLOW'
          ? row.transaction.amountMinor
          : -row.transaction.amountMinor),
      reconciliation.openingBalanceMinor,
    );
    return reconciliation.closingBalanceMinor - runningBalance;
  }

  private async findOrThrow(organizationId: string, reconciliationId: string) {
    const reconciliation = await this.prisma.reconciliation.findFirst({
      where: { id: reconciliationId, organizationId },
    });
    if (!reconciliation) throw new NotFoundException('Reconciliation not found.');
    return reconciliation;
  }
}

function summarize(reconciliation: {
  id: string;
  financialAccountId: string;
  statementStartDate: Date;
  statementEndDate: Date;
  openingBalanceMinor: bigint;
  closingBalanceMinor: bigint;
  status: string;
  completedAt: Date | null;
  completedByUserId: string | null;
  reopenedAt: Date | null;
  reopenedByUserId: string | null;
  reopenReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: reconciliation.id,
    financialAccountId: reconciliation.financialAccountId,
    statementStartDate: dateOnly(reconciliation.statementStartDate),
    statementEndDate: dateOnly(reconciliation.statementEndDate),
    openingBalanceMinor: reconciliation.openingBalanceMinor.toString(),
    closingBalanceMinor: reconciliation.closingBalanceMinor.toString(),
    status: reconciliation.status,
    completedAt: reconciliation.completedAt?.toISOString() ?? null,
    completedByUserId: reconciliation.completedByUserId,
    reopenedAt: reconciliation.reopenedAt?.toISOString() ?? null,
    reopenedByUserId: reconciliation.reopenedByUserId,
    reopenReason: reconciliation.reopenReason,
    createdAt: reconciliation.createdAt.toISOString(),
    updatedAt: reconciliation.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
