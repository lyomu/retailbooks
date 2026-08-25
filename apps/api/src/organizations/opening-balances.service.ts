import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  FiscalPeriodStatus,
  LedgerAccountStatus,
  OpeningBalanceBatchStatus,
  type Prisma,
} from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import type { PostingRule, PostingRuleSourceContext } from '../posting-rules/posting-rule.js';
import { accountIdRef, systemKeyRef } from '../posting-rules/posting-rule.js';
import { PostingRulesService } from '../posting-rules/posting-rules.service.js';
import { writeAuditEvent } from './audit-event.js';
import { LedgerService } from './ledger.service.js';
import type {
  CreateOpeningBalanceBatchDto,
  OpeningBalanceLineDto,
  OpeningBalancePartyLineDto,
} from './opening-balances.dto.js';
import type { OrganizationContext } from './organization-context.js';

const CONTROL_ACCOUNT_KEYS = new Set(['accounts_receivable', 'accounts_payable']);

type BatchWithContents = Prisma.OpeningBalanceBatchGetPayload<{
  include: { lines: true; partyLines: true };
}>;

interface FinalizeSource extends PostingRuleSourceContext {
  description?: string;
  lines: readonly {
    accountId: string;
    description?: string;
    debitMinor: bigint;
    creditMinor: bigint;
  }[];
  receivableTotal: bigint;
  payableTotal: bigint;
}

/**
 * The Opening Balances wizard. A batch collects account-level lines plus contact-level AR and
 * vendor-level AP detail; validation requires the whole batch to balance, with party detail
 * aggregating into its control account by construction -- party lines are the only way to move
 * AR/AP, so a manual line against those control accounts is rejected. Finalize posts once through
 * the declarative rule library as a single balanced journal, idempotent per batch.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rules: PostingRulesService,
  ) {}

  private readonly finalizeRule: PostingRule<FinalizeSource> = {
    event: 'OPENING_BALANCE_FINALIZE',
    sourceType: 'OPENING_BALANCE',
    version: 1,
    describe: (source) =>
      source.description ??
      `Opening balances as of ${source.journalDate.toISOString().slice(0, 10)}`,
    lines: (source) => [
      ...source.lines.map((line) => ({
        account: accountIdRef(line.accountId),
        description: line.description,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
      })),
      ...(source.receivableTotal > 0n
        ? [
            {
              account: systemKeyRef('accounts_receivable'),
              description: 'Opening accounts receivable',
              debitMinor: source.receivableTotal,
            },
          ]
        : []),
      ...(source.payableTotal > 0n
        ? [
            {
              account: systemKeyRef('accounts_payable'),
              description: 'Opening accounts payable',
              creditMinor: source.payableTotal,
            },
          ]
        : []),
    ],
  };

  async createBatch(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateOpeningBalanceBatchDto,
    metadata: RequestMetadata,
  ) {
    const batchId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.openingBalanceBatch.create({
        data: {
          organizationId: context.id,
          asOfDate: isoDate(input.asOfDate),
          description: input.description,
        },
      });
      await this.replaceContents(
        tx,
        context.id,
        created.id,
        input.lines ?? [],
        input.partyLines ?? [],
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'opening_balances.created',
        entityType: 'opening_balance_batch',
        entityId: created.id,
        action: AuditAction.CREATE,
        after: { asOfDate: dateOnly(created.asOfDate) },
        ipHash: metadata.ipHash,
      });
      return created.id;
    });
    return this.detail(context.id, batchId);
  }

  async updateDraft(
    context: OrganizationContext,
    user: PublicUser,
    batchId: string,
    input: CreateOpeningBalanceBatchDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.openingBalanceBatch.findFirst({
      where: { id: batchId, organizationId: context.id },
      select: { status: true },
    });
    if (!existing) throw new NotFoundException('Opening balance batch not found.');
    if (
      existing.status !== OpeningBalanceBatchStatus.DRAFT &&
      existing.status !== OpeningBalanceBatchStatus.VALIDATED
    ) {
      throw new ConflictException('Only draft or validated batches can be edited.');
    }

    const beforeStatus = existing.status;
    await this.prisma.$transaction(async (tx) => {
      await tx.openingBalanceBatch.update({
        where: { id: batchId },
        data: {
          asOfDate: isoDate(input.asOfDate),
          description: input.description,
          // Any edit invalidates a prior validation pass.
          status: OpeningBalanceBatchStatus.DRAFT,
          validatedAt: null,
        },
      });
      await this.replaceContents(
        tx,
        context.id,
        batchId,
        input.lines ?? [],
        input.partyLines ?? [],
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'opening_balances.updated',
        entityType: 'opening_balance_batch',
        entityId: batchId,
        action: AuditAction.UPDATE,
        before: { status: beforeStatus },
        after: { status: OpeningBalanceBatchStatus.DRAFT },
        ipHash: metadata.ipHash,
      });
    });
    return this.detail(context.id, batchId);
  }

  async list(organizationId: string, status?: OpeningBalanceBatchStatus) {
    const batches = await this.prisma.openingBalanceBatch.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
      include: { _count: { select: { lines: true, partyLines: true } } },
    });
    return batches.map((batch) => ({
      id: batch.id,
      status: batch.status,
      asOfDate: dateOnly(batch.asOfDate),
      description: batch.description,
      lineCount: batch._count.lines,
      partyLineCount: batch._count.partyLines,
      journalId: batch.journalId,
      finalizedAt: batch.finalizedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
    }));
  }

  async detail(organizationId: string, batchId: string) {
    const batch = await this.loadBatch(organizationId, batchId);
    const totals = computeTotals(batch.lines, batch.partyLines);
    return {
      id: batch.id,
      status: batch.status,
      asOfDate: dateOnly(batch.asOfDate),
      description: batch.description,
      lines: batch.lines.map((line) => ({
        id: line.id,
        accountId: line.accountId,
        debitMinor: line.debitMinor.toString(),
        creditMinor: line.creditMinor.toString(),
        description: line.description,
      })),
      partyLines: batch.partyLines.map((line) => ({
        id: line.id,
        side: line.side,
        contactId: line.contactId,
        vendorId: line.vendorId,
        nameSnapshot: line.nameSnapshot,
        amountMinor: line.amountMinor.toString(),
      })),
      totals: {
        debitMinor: totals.debitTotal.toString(),
        creditMinor: totals.creditTotal.toString(),
        receivableTotalMinor: totals.receivableTotal.toString(),
        payableTotalMinor: totals.payableTotal.toString(),
        balanced: totals.debitTotal === totals.creditTotal && totals.debitTotal > 0n,
      },
      journalId: batch.journalId,
      validatedAt: batch.validatedAt?.toISOString() ?? null,
      finalizedAt: batch.finalizedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
    };
  }

  /**
   * Runs the full validation gate and flips DRAFT -> VALIDATED. Balanced-import validation is a
   * hard precondition of finalize: an unbalanced or structurally invalid batch can never post.
   */
  async validate(
    context: OrganizationContext,
    user: PublicUser,
    batchId: string,
    metadata: RequestMetadata,
  ) {
    const batch = await this.loadBatch(context.id, batchId);
    if (
      batch.status !== OpeningBalanceBatchStatus.DRAFT &&
      batch.status !== OpeningBalanceBatchStatus.VALIDATED
    ) {
      throw new ConflictException('Only draft batches can be validated.');
    }

    const errors = await this.validationErrors(batch);
    if (errors.length > 0) throw new BadRequestException(errors.join(' '));

    await this.prisma.$transaction(async (tx) => {
      await tx.openingBalanceBatch.update({
        where: { id: batch.id },
        data: {
          status: OpeningBalanceBatchStatus.VALIDATED,
          validatedAt: new Date(),
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'opening_balances.validated',
        entityType: 'opening_balance_batch',
        entityId: batch.id,
        action: AuditAction.UPDATE,
        before: { status: batch.status },
        after: { status: OpeningBalanceBatchStatus.VALIDATED },
        ipHash: metadata.ipHash,
      });
    });
    return this.detail(context.id, batchId);
  }

  async finalize(
    context: OrganizationContext,
    user: PublicUser,
    batchId: string,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const journalId = await this.prisma.$transaction(async (tx) => {
      const batch = await this.loadBatch(context.id, batchId, tx);
      if (batch.journalId && batch.status === OpeningBalanceBatchStatus.FINALIZED) {
        // Idempotent replay for an already-finalized batch.
        return batch.journalId;
      }
      if (batch.status !== OpeningBalanceBatchStatus.VALIDATED) {
        throw new ConflictException('Validate the batch before finalizing it.');
      }
      // Re-run the full gate at finalize time: contents may have drifted since validate().
      const errors = await this.validationErrors(batch, tx);
      if (errors.length > 0) throw new BadRequestException(errors.join(' '));

      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      const totals = computeTotals(batch.lines, batch.partyLines);
      const journal = await this.rules.post(
        context,
        user,
        this.finalizeRule,
        {
          sourceId: batch.id,
          journalDate: batch.asOfDate,
          currency: organization.baseCurrency,
          lines: batch.lines.map((line) => ({
            accountId: line.accountId,
            description: line.description ?? undefined,
            debitMinor: line.debitMinor,
            creditMinor: line.creditMinor,
          })),
          receivableTotal: totals.receivableTotal,
          payableTotal: totals.payableTotal,
        },
        metadata,
        idempotencyKey ?? `BATCH:${batch.id}`,
        tx,
      );

      await tx.openingBalanceBatch.update({
        where: { id: batch.id },
        data: {
          status: OpeningBalanceBatchStatus.FINALIZED,
          journalId: journal.id,
          finalizedAt: new Date(),
          finalizedByUserId: user.id,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'opening_balances.finalized',
        entityType: 'opening_balance_batch',
        entityId: batch.id,
        action: AuditAction.UPDATE,
        before: { status: batch.status },
        after: { status: OpeningBalanceBatchStatus.FINALIZED, journalId: journal.id },
        ipHash: metadata.ipHash,
      });
      return journal.id;
    });
    return { batchId, journalId };
  }

  /**
   * Voiding a finalized batch reverses its journal exactly, but only while the affected accounts
   * are otherwise untouched on or after the batch's as-of date -- opening balances describe a
   * starting point, so later activity on those accounts means the books have moved on.
   */
  async voidBatch(
    context: OrganizationContext,
    user: PublicUser,
    batchId: string,
    reason: string | undefined,
    metadata: RequestMetadata,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const batch = await this.loadBatch(context.id, batchId, tx);
      if (!batch.journalId || batch.status !== OpeningBalanceBatchStatus.FINALIZED) {
        throw new ConflictException('Only finalized batches can be voided.');
      }

      const controlAccounts = await tx.ledgerAccount.findMany({
        where: { organizationId: context.id, systemKey: { in: [...CONTROL_ACCOUNT_KEYS] } },
        select: { id: true },
      });
      const guardedAccountIds = [
        ...new Set([
          ...batch.lines.map((line) => line.accountId),
          ...controlAccounts.map((a) => a.id),
        ]),
      ];

      const laterActivity = await tx.journalLine.count({
        where: {
          organizationId: context.id,
          accountId: { in: guardedAccountIds },
          journal: {
            status: 'POSTED',
            id: { not: batch.journalId },
            journalDate: { gte: batch.asOfDate },
            reversalOfJournalId: null,
          },
        },
      });
      if (laterActivity > 0) {
        throw new ConflictException(
          'Accounts touched by this batch have other activity on or after its as-of date; reverse that activity first.',
        );
      }

      await this.ledger.reverseJournal(
        context,
        user,
        batch.journalId,
        {
          journalDate: dateOnly(new Date()),
          description: reason ?? `Void opening balance batch ${batch.id}`,
        },
        metadata,
        undefined,
        tx,
      );
      await tx.openingBalanceBatch.update({
        where: { id: batch.id },
        data: { status: OpeningBalanceBatchStatus.VOID },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'opening_balances.voided',
        entityType: 'opening_balance_batch',
        entityId: batch.id,
        action: AuditAction.UPDATE,
        before: { status: batch.status },
        after: { status: OpeningBalanceBatchStatus.VOID },
        ipHash: metadata.ipHash,
      });
    });
    return this.detail(context.id, batchId);
  }

  private async loadBatch(
    organizationId: string,
    batchId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<BatchWithContents> {
    const batch = await client.openingBalanceBatch.findFirst({
      where: { id: batchId, organizationId },
      include: { lines: true, partyLines: true },
    });
    if (!batch) throw new NotFoundException('Opening balance batch not found.');
    return batch;
  }

  private async replaceContents(
    tx: Prisma.TransactionClient,
    organizationId: string,
    batchId: string,
    lines: OpeningBalanceLineDto[],
    partyLines: OpeningBalancePartyLineDto[],
  ) {
    await tx.openingBalanceLine.deleteMany({ where: { batchId } });
    await tx.openingBalancePartyLine.deleteMany({ where: { batchId } });

    if (lines.length > 0) {
      await tx.openingBalanceLine.createMany({
        data: lines.map((line) => ({
          organizationId,
          batchId,
          accountId: line.accountId,
          debitMinor: BigInt(line.debitMinor),
          creditMinor: BigInt(line.creditMinor),
          description: line.description,
        })),
      });
    }

    for (const [index, party] of partyLines.entries()) {
      if (party.side === 'RECEIVABLE') {
        const contact = await tx.contact.findFirst({
          where: { id: party.contactId, organizationId },
          select: { displayName: true },
        });
        if (!contact) {
          throw new BadRequestException(`Party line ${index + 1}: contact not found.`);
        }
        await tx.openingBalancePartyLine.create({
          data: {
            organizationId,
            batchId,
            side: 'RECEIVABLE',
            contactId: party.contactId!,
            amountMinor: BigInt(party.amountMinor),
            nameSnapshot: contact.displayName,
          },
        });
      } else {
        const vendor = await tx.vendor.findFirst({
          where: { id: party.vendorId, organizationId },
          select: { displayName: true },
        });
        if (!vendor) {
          throw new BadRequestException(`Party line ${index + 1}: vendor not found.`);
        }
        await tx.openingBalancePartyLine.create({
          data: {
            organizationId,
            batchId,
            side: 'PAYABLE',
            vendorId: party.vendorId!,
            amountMinor: BigInt(party.amountMinor),
            nameSnapshot: vendor.displayName,
          },
        });
      }
    }
  }

  /**
   * The full structural + balance gate, shared by validate() and re-run at finalize(). Returns
   * human-readable errors; an empty list means the batch may post.
   */
  private async validationErrors(
    batch: BatchWithContents,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string[]> {
    const errors: string[] = [];

    const accountIds = [...new Set(batch.lines.map((line) => line.accountId))];
    const accounts = accountIds.length
      ? await client.ledgerAccount.findMany({
          where: { id: { in: accountIds }, organizationId: batch.organizationId },
        })
      : [];
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    for (const [index, line] of batch.lines.entries()) {
      const label = `Line ${index + 1}`;
      const account = accountById.get(line.accountId);
      if (!account) {
        errors.push(`${label}: unknown account.`);
        continue;
      }
      if (account.systemKey && CONTROL_ACCOUNT_KEYS.has(account.systemKey)) {
        errors.push(
          `${label}: use party-level balances for ${account.name}; a manual line against a control account is not allowed.`,
        );
      }
      if (account.status !== LedgerAccountStatus.ACTIVE)
        errors.push(`${label}: account is not active.`);
      if (line.debitMinor < 0n || line.creditMinor < 0n) errors.push(`${label}: negative amounts.`);
      if (line.debitMinor > 0n && line.creditMinor > 0n)
        errors.push(`${label}: both debit and credit.`);
      if (line.debitMinor === 0n && line.creditMinor === 0n) errors.push(`${label}: empty line.`);
    }

    const seenParties = new Set<string>();
    for (const [index, party] of batch.partyLines.entries()) {
      const label = `Party line ${index + 1}`;
      if (party.amountMinor <= 0n) errors.push(`${label}: amount must be positive.`);
      const partyId = party.side === 'RECEIVABLE' ? party.contactId : party.vendorId;
      const key = `${party.side}:${partyId}`;
      if (seenParties.has(key)) errors.push(`${label}: duplicate party entry in the same batch.`);
      seenParties.add(key);
    }

    const totals = computeTotals(batch.lines, batch.partyLines);
    if (totals.debitTotal <= 0n || totals.creditTotal <= 0n) {
      errors.push('The batch must move value on both sides.');
    }
    if (totals.debitTotal !== totals.creditTotal) {
      errors.push(
        `The batch does not balance: debits ${totals.debitTotal} vs credits ${totals.creditTotal}. Adjust lines until they match.`,
      );
    }

    // Early feedback on the period; finalize enforces it again inside the posting path.
    const period = await client.fiscalPeriod.findFirst({
      where: {
        organizationId: batch.organizationId,
        startsOn: { lte: isoDate(dateOnly(batch.asOfDate)) },
        endsOn: { gte: isoDate(dateOnly(batch.asOfDate)) },
      },
      select: { status: true, code: true },
    });
    if (!period) errors.push('Create a fiscal period covering the as-of date first.');
    else if (period.status !== FiscalPeriodStatus.OPEN) {
      errors.push(`Fiscal period ${period.code} is not open.`);
    }

    return [...new Set(errors)];
  }
}

function computeTotals(
  lines: readonly { debitMinor: bigint; creditMinor: bigint }[],
  partyLines: readonly { side: string; amountMinor: bigint }[],
) {
  let accountDebits = 0n;
  let accountCredits = 0n;
  let receivableTotal = 0n;
  let payableTotal = 0n;
  for (const line of lines) {
    accountDebits += line.debitMinor;
    accountCredits += line.creditMinor;
  }
  for (const party of partyLines) {
    if (party.side === 'RECEIVABLE') receivableTotal += party.amountMinor;
    else payableTotal += party.amountMinor;
  }
  return {
    receivableTotal,
    payableTotal,
    debitTotal: accountDebits + receivableTotal,
    creditTotal: accountCredits + payableTotal,
  };
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
