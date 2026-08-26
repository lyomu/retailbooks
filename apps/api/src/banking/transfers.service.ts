import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { CurrencyService } from '../organizations/currency.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { TRANSFER_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { PostingRulesService } from '../posting-rules/posting-rules.service.js';
import { TRANSFER_POST_RULE } from './transfer-posting-rule.js';
import type { CreateTransferDto } from './transfers.dto.js';

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rules: PostingRulesService,
    private readonly currency: CurrencyService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async list(organizationId: string, financialAccountId?: string) {
    const transfers = await this.prisma.transfer.findMany({
      where: {
        organizationId,
        ...(financialAccountId
          ? {
              OR: [
                { fromFinancialAccountId: financialAccountId },
                { toFinancialAccountId: financialAccountId },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    return transfers.map(summarize);
  }

  async detail(organizationId: string, transferId: string) {
    const transfer = await this.findOrThrow(organizationId, transferId);
    return summarize(transfer);
  }

  /**
   * Posts a balanced Transfer between two financial accounts. Both legs' amounts are supplied
   * explicitly (real-world transfers often land at a different amount than they left, due to
   * spread/fees when currencies differ) and independently converted to the organization's base
   * currency for the GL posting -- see `TRANSFER_POST_RULE`'s doc comment for why this is done
   * synchronously here rather than via `LedgerService#prepareFxPosting`'s per-line mechanism.
   */
  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateTransferDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    if (input.fromFinancialAccountId === input.toFinancialAccountId) {
      throw new BadRequestException('A transfer must move between two different accounts.');
    }
    const fromAmountMinor = BigInt(input.fromAmountMinor);
    const toAmountMinor = BigInt(input.toAmountMinor);
    if (fromAmountMinor <= 0n || toAmountMinor <= 0n) {
      throw new BadRequestException('Transfer amounts must be greater than zero.');
    }

    const [fromAccount, toAccount] = await Promise.all([
      this.prisma.financialAccount.findFirst({
        where: { id: input.fromFinancialAccountId, organizationId: context.id },
      }),
      this.prisma.financialAccount.findFirst({
        where: { id: input.toFinancialAccountId, organizationId: context.id },
      }),
    ]);
    if (!fromAccount) throw new NotFoundException('Source financial account not found.');
    if (!toAccount) throw new NotFoundException('Destination financial account not found.');
    if (!fromAccount.active || !toAccount.active) {
      throw new ConflictException('Both accounts must be active to transfer between them.');
    }
    if (fromAccount.currency === toAccount.currency && fromAmountMinor !== toAmountMinor) {
      throw new BadRequestException(
        'Same-currency transfers must have equal amounts on both legs.',
      );
    }

    const transferDate = isoDate(input.transferDate);
    const description = input.description ?? `Transfer: ${fromAccount.name} to ${toAccount.name}`;

    const posted = await this.prisma.$transaction(async (tx) => {
      await this.lockTransferIdempotency(tx, context.id, idempotencyKey);
      const existingResult = await this.findTransferIdempotentResult(context.id, idempotencyKey, tx);
      if (existingResult) {
        return tx.transfer.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
        });
      }

      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });

      const fromBaseMinor = await this.toBaseCurrencyMinor(
        tx,
        context.id,
        organization.baseCurrency,
        fromAccount.currency,
        fromAmountMinor,
        transferDate,
      );
      const toBaseMinor = await this.toBaseCurrencyMinor(
        tx,
        context.id,
        organization.baseCurrency,
        toAccount.currency,
        toAmountMinor,
        transferDate,
      );

      const transferId = randomUUID();

      const postedJournal = await this.rules.post(
        context,
        user,
        TRANSFER_POST_RULE,
        {
          sourceId: transferId,
          journalDate: transferDate,
          currency: organization.baseCurrency,
          description,
          sourceGlAccountId: fromAccount.glAccountId,
          destinationGlAccountId: toAccount.glAccountId,
          sourceBaseMinor: fromBaseMinor,
          destinationBaseMinor: toBaseMinor,
        },
        metadata,
        undefined,
        tx,
      );

      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        TRANSFER_DOCUMENT_TYPE,
        transferDate,
      );

      const exchangeRate =
        fromAccount.currency !== toAccount.currency
          ? computeInformationalRate(fromAmountMinor, toAmountMinor)
          : null;

      const transfer = await tx.transfer.create({
        data: {
          id: transferId,
          organizationId: context.id,
          transferNumber: allocation.value,
          transferDate,
          description,
          fromFinancialAccountId: fromAccount.id,
          toFinancialAccountId: toAccount.id,
          fromCurrency: fromAccount.currency,
          toCurrency: toAccount.currency,
          fromAmountMinor,
          toAmountMinor,
          exchangeRate,
          journalId: postedJournal.id,
          createdByUserId: user.id,
        },
      });

      await tx.financialAccount.updateMany({
        where: { id: { in: [fromAccount.id, toAccount.id] } },
        data: { lastActivityAt: new Date() },
      });

      await this.recordTransferIdempotency(tx, context.id, idempotencyKey, transfer.id);
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.transfer_posted',
        entityType: 'transfer',
        entityId: transfer.id,
        action: AuditAction.CREATE,
        after: {
          fromFinancialAccountId: fromAccount.id,
          toFinancialAccountId: toAccount.id,
          fromAmountMinor: fromAmountMinor.toString(),
          toAmountMinor: toAmountMinor.toString(),
        },
        ipHash: metadata.ipHash,
      });

      return transfer;
    });

    return summarize(posted);
  }

  async void(
    context: OrganizationContext,
    user: PublicUser,
    transferId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, transferId);
    if (existing.status !== 'POSTED') {
      throw new ConflictException('Only posted transfers can be voided.');
    }
    const matched = await this.prisma.match.findFirst({
      where: { targetType: 'TRANSFER', targetId: transferId },
    });
    if (matched) {
      throw new ConflictException('This transfer is matched to a bank transaction; unmatch it first.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const reversal = await this.ledger.reverseJournal(
        context,
        user,
        existing.journalId,
        { description: `Void of transfer ${existing.transferNumber ?? existing.id}` },
        metadata,
        undefined,
        tx,
      );

      const transfer = await tx.transfer.update({
        where: { id: transferId },
        data: { status: 'VOID', voidedAt: new Date(), voidJournalId: reversal.id },
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.transfer_voided',
        entityType: 'transfer',
        entityId: transferId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: 'VOID' },
        ipHash: metadata.ipHash,
      });

      return transfer;
    });

    return summarize(updated);
  }

  private async toBaseCurrencyMinor(
    tx: Prisma.TransactionClient,
    organizationId: string,
    baseCurrency: string,
    legCurrency: string,
    legAmountMinor: bigint,
    journalDate: Date,
  ): Promise<bigint> {
    if (legCurrency === baseCurrency) return legAmountMinor;
    const { rate, base, quote } = await this.currency.resolveRate(
      tx,
      organizationId,
      baseCurrency,
      legCurrency,
      journalDate,
    );
    return this.currency.convert({ foreignAmountMinor: legAmountMinor, exchangeRate: rate, base, quote });
  }

  private async findOrThrow(organizationId: string, transferId: string) {
    const transfer = await this.prisma.transfer.findFirst({
      where: { id: transferId, organizationId },
    });
    if (!transfer) throw new NotFoundException('Transfer not found.');
    return transfer;
  }

  private async lockTransferIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key?: string,
  ): Promise<void> {
    if (!key) return;
    const lockKey = `${organizationId}:TRANSFER_CREATE:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private async findTransferIdempotentResult(
    organizationId: string,
    key: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return tx.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: { organizationId, operation: 'TRANSFER_CREATE_TRANSFER', key },
      },
      select: { resourceId: true },
    });
  }

  private recordTransferIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key: string | undefined,
    transferId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation: 'TRANSFER_CREATE_TRANSFER',
        key,
        resourceType: 'TRANSFER',
        resourceId: transferId,
      },
    });
  }
}

/** Informational only -- never used to derive posted amounts, both legs are always given
 * explicitly. Kept at reasonable precision for display. */
function computeInformationalRate(fromAmountMinor: bigint, toAmountMinor: bigint): string {
  if (fromAmountMinor === 0n) return '0';
  const scaled = (toAmountMinor * 10_000_000_000n) / fromAmountMinor;
  return (Number(scaled) / 10_000_000_000).toFixed(10);
}

function summarize(transfer: {
  id: string;
  transferNumber: string | null;
  status: string;
  transferDate: Date;
  description: string | null;
  fromFinancialAccountId: string;
  toFinancialAccountId: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmountMinor: bigint;
  toAmountMinor: bigint;
  exchangeRate: unknown;
  journalId: string;
  voidedAt: Date | null;
  voidJournalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: transfer.id,
    transferNumber: transfer.transferNumber,
    status: transfer.status,
    transferDate: dateOnly(transfer.transferDate),
    description: transfer.description,
    fromFinancialAccountId: transfer.fromFinancialAccountId,
    toFinancialAccountId: transfer.toFinancialAccountId,
    fromCurrency: transfer.fromCurrency,
    toCurrency: transfer.toCurrency,
    fromAmountMinor: transfer.fromAmountMinor.toString(),
    toAmountMinor: transfer.toAmountMinor.toString(),
    exchangeRate: transfer.exchangeRate?.toString() ?? null,
    journalId: transfer.journalId,
    voidedAt: transfer.voidedAt?.toISOString() ?? null,
    voidJournalId: transfer.voidJournalId,
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
