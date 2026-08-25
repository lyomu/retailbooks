import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';
import { roundHalfUpDivide } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { VENDOR_CREDIT_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { TaxService } from '../organizations/tax.service.js';
import type {
  AllocateVendorCreditDto,
  CreateVendorCreditDto,
  UpdateVendorCreditDto,
  VendorCreditLineDto,
} from './vendor-credits.dto.js';

const QUANTITY_SCALE = 10_000n;

type VendorCreditWithDetail = Prisma.VendorCreditGetPayload<{
  include: typeof vendorCreditDetailInclude;
}>;

const vendorCreditDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  vendor: { select: { id: true, displayName: true, currency: true, payableAccountId: true } },
  allocations: {
    include: { bill: { select: { id: true, billNumber: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.VendorCreditInclude;

/**
 * Payable-side mirror of CreditNotesService, minus a refund path. Vendor Credits issue into the
 * `vendor_credit` asset account, not directly against `accounts_payable` -- `allocate()` is what
 * actually posts `DR accounts_payable, CR vendor_credit` against a specific Bill, mirroring
 * `CreditNotesService#allocate` exactly, including its _corrected_ over-allocation guard shape
 * (compare `requested` directly against the freshly re-read `bill.balanceMinor`, never adding back
 * this vendor credit's own prior allocations -- that exact double-count bug is what 2E's tests
 * caught on the Sales side, and there is no test safety net this time, so it's copied verbatim).
 */
@Injectable()
export class VendorCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly tax: TaxService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async list(organizationId: string, status?: string) {
    const vendorCredits = await this.prisma.vendorCredit.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: vendorCreditDetailInclude,
      take: 200,
    });
    return vendorCredits.map(summarizeVendorCredit);
  }

  async detail(organizationId: string, vendorCreditId: string) {
    const vendorCredit = await this.findOrThrow(organizationId, vendorCreditId);
    return summarizeVendorCredit(vendorCredit);
  }

  async createDraft(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateVendorCreditDto,
    metadata: RequestMetadata,
  ) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: input.vendorId, organizationId: context.id },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');
    if (vendor.status !== 'ACTIVE') {
      throw new ConflictException('Cannot credit a deactivated vendor.');
    }
    if (input.sourceBillId) {
      const bill = await this.prisma.bill.findFirst({
        where: { id: input.sourceBillId, organizationId: context.id, vendorId: vendor.id },
      });
      if (!bill) throw new NotFoundException('Source bill not found.');
    }
    const currency = input.currency ?? vendor.currency;
    const resolvedLines = await this.resolveLines(context.id, input.lines);
    const totals = lineTotals(resolvedLines);

    const created = await this.prisma.$transaction(async (tx) => {
      const vendorCredit = await tx.vendorCredit.create({
        data: {
          organizationId: context.id,
          vendorId: vendor.id,
          sourceBillId: input.sourceBillId ?? null,
          reason: input.reason ?? null,
          currency,
          subtotalMinor: totals.subtotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          totalMinor: totals.totalMinor,
          remainingMinor: 0n,
          createdByUserId: user.id,
          lines: {
            create: resolvedLines.map((line, index) => lineCreateData(line, index, context.id)),
          },
        },
        include: vendorCreditDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.vendor_credit_created',
        entityType: 'vendor_credit',
        entityId: vendorCredit.id,
        action: AuditAction.CREATE,
        after: { vendorId: vendor.id, totalMinor: totals.totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return vendorCredit;
    });

    return summarizeVendorCredit(created);
  }

  async updateDraft(
    context: OrganizationContext,
    user: PublicUser,
    vendorCreditId: string,
    input: UpdateVendorCreditDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, vendorCreditId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft vendor credits can be edited.');
    }

    let vendor = existing.vendor;
    if (input.vendorId && input.vendorId !== existing.vendorId) {
      const nextVendor = await this.prisma.vendor.findFirst({
        where: { id: input.vendorId, organizationId: context.id },
      });
      if (!nextVendor) throw new NotFoundException('Vendor not found.');
      if (nextVendor.status !== 'ACTIVE') {
        throw new ConflictException('Cannot credit a deactivated vendor.');
      }
      vendor = {
        id: nextVendor.id,
        displayName: nextVendor.displayName,
        currency: nextVendor.currency,
        payableAccountId: nextVendor.payableAccountId,
      };
    }

    const currency = input.currency ?? vendor.currency;
    const resolvedLines = input.lines ? await this.resolveLines(context.id, input.lines) : null;
    const totals = resolvedLines
      ? lineTotals(resolvedLines)
      : {
          subtotalMinor: existing.subtotalMinor,
          taxTotalMinor: existing.taxTotalMinor,
          totalMinor: existing.totalMinor,
        };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.vendorCreditLine.deleteMany({ where: { vendorCreditId } });
      }
      const vendorCredit = await tx.vendorCredit.update({
        where: { id: vendorCreditId },
        data: {
          vendorId: vendor.id,
          currency,
          ...(input.sourceBillId !== undefined ? { sourceBillId: input.sourceBillId || null } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          subtotalMinor: totals.subtotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          totalMinor: totals.totalMinor,
          ...(resolvedLines
            ? {
                lines: {
                  create: resolvedLines.map((line, index) =>
                    lineCreateData(line, index, context.id),
                  ),
                },
              }
            : {}),
        },
        include: vendorCreditDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.vendor_credit_updated',
        entityType: 'vendor_credit',
        entityId: vendorCreditId,
        action: AuditAction.UPDATE,
        before: { totalMinor: existing.totalMinor.toString() },
        after: { totalMinor: totals.totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return vendorCredit;
    });

    return summarizeVendorCredit(updated);
  }

  /**
   * Issues a draft vendor credit: freezes each line's tax snapshot, and posts the reversal of the
   * original purchase -- credits the expense/inventory/asset account and recoverable tax (reversing
   * what the Bill debited), debits `vendor_credit` for the total. Mirrors
   * `CreditNotesService#issueCreditNote` sign-flipped.
   */
  async issueVendorCredit(
    context: OrganizationContext,
    user: PublicUser,
    vendorCreditId: string,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const issued = await this.prisma.$transaction(async (tx) => {
      await this.lockVendorCreditIdempotency(tx, context.id, 'VENDOR_CREDIT_ISSUE', idempotencyKey);
      const existingResult = await this.findVendorCreditIdempotentResult(
        context.id,
        'VENDOR_CREDIT_ISSUE',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.vendorCredit.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: vendorCreditDetailInclude,
        });
      }

      await this.lockVendorCreditRow(tx, context.id, vendorCreditId);
      const vendorCredit = await tx.vendorCredit.findFirst({
        where: { id: vendorCreditId, organizationId: context.id },
        include: vendorCreditDetailInclude,
      });
      if (!vendorCredit) throw new NotFoundException('Vendor credit not found.');
      if (vendorCredit.status !== 'DRAFT') {
        throw new ConflictException('Only draft vendor credits can be issued.');
      }
      if (vendorCredit.lines.length === 0) {
        throw new BadRequestException(
          'A vendor credit needs at least one line before it can be issued.',
        );
      }

      const issueDate = dateOnly(new Date());

      const vendorCreditAccount = await this.ledger.accountBySystemKey(
        context.id,
        'vendor_credit',
        tx,
      );

      const expenseByAccount = new Map<string, bigint>();
      const taxByCode = new Map<string, { accountId: string; amountMinor: bigint }>();
      let subtotalMinor = 0n;
      let taxTotalMinor = 0n;

      for (const line of vendorCredit.lines) {
        subtotalMinor += line.lineTotalMinor;
        const accountId =
          line.accountId ??
          (await this.ledger.accountBySystemKey(context.id, 'general_expense', tx)).id;
        expenseByAccount.set(
          accountId,
          (expenseByAccount.get(accountId) ?? 0n) + line.lineTotalMinor,
        );

        if (line.taxCodeId) {
          const resolved = await this.tax.resolveForPosting(
            tx,
            context.id,
            line.taxCodeId,
            line.lineTotalMinor,
            issueDate,
          );
          await tx.vendorCreditLine.update({
            where: { id: line.id },
            data: {
              taxCodeSnapshot: resolved.taxCode,
              taxTreatmentSnapshot: resolved.treatment,
              taxRecoverableSnapshot: resolved.recoverable,
              taxRatePercentSnapshot: resolved.ratePercent,
              taxableAmountMinor: resolved.taxableAmountMinor,
              taxAmountMinor: resolved.taxAmountMinor,
            },
          });
          if (resolved.taxAmountMinor > 0n) {
            const taxAccountId =
              resolved.purchaseTaxAccountId ??
              (await this.ledger.accountBySystemKey(context.id, 'tax_receivable', tx)).id;
            const current = taxByCode.get(line.taxCodeId) ?? {
              accountId: taxAccountId,
              amountMinor: 0n,
            };
            current.amountMinor += resolved.taxAmountMinor;
            taxByCode.set(line.taxCodeId, current);
            taxTotalMinor += resolved.taxAmountMinor;
          }
        }
      }

      const totalMinor = subtotalMinor + taxTotalMinor;
      if (totalMinor <= 0n) {
        throw new BadRequestException('A vendor credit total must be greater than zero.');
      }

      const description = `Vendor credit from ${vendorCredit.vendor.displayName}`;
      const journalLines = [
        ...[...expenseByAccount.entries()].map(([accountId, amountMinor]) => ({
          accountId,
          debitMinor: 0n,
          creditMinor: amountMinor,
          description,
        })),
        ...[...taxByCode.values()].map((entry) => ({
          accountId: entry.accountId,
          debitMinor: 0n,
          creditMinor: entry.amountMinor,
          description: `Vendor credit tax reversal from ${vendorCredit.vendor.displayName}`,
        })),
        {
          accountId: vendorCreditAccount.id,
          debitMinor: totalMinor,
          creditMinor: 0n,
          description,
        },
      ];

      const postedJournal = await this.ledger.postJournalFromLines(
        context,
        user,
        'VENDOR_CREDIT_ISSUE',
        {
          journalDate: new Date(`${issueDate}T00:00:00.000Z`),
          currency: vendorCredit.currency,
          description,
          sourceType: 'VENDOR_CREDIT',
          sourceId: vendorCredit.id,
          lines: journalLines,
        },
        metadata,
        undefined,
        tx,
      );

      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        VENDOR_CREDIT_DOCUMENT_TYPE,
        new Date(`${issueDate}T00:00:00.000Z`),
      );

      const updated = await tx.vendorCredit.update({
        where: { id: vendorCreditId },
        data: {
          status: 'ISSUED',
          vendorCreditNumber: allocation.value,
          issueDate: isoDate(issueDate),
          subtotalMinor,
          taxTotalMinor,
          totalMinor,
          remainingMinor: totalMinor,
          journalId: postedJournal.id,
        },
        include: vendorCreditDetailInclude,
      });

      await this.recordVendorCreditIdempotency(
        tx,
        context.id,
        'VENDOR_CREDIT_ISSUE',
        idempotencyKey,
        vendorCreditId,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.vendor_credit_issued',
        entityType: 'vendor_credit',
        entityId: vendorCreditId,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: {
          status: 'ISSUED',
          vendorCreditNumber: allocation.value,
          totalMinor: totalMinor.toString(),
        },
        ipHash: metadata.ipHash,
      });

      return updated;
    });

    return summarizeVendorCredit(issued);
  }

  /** Only allowed while nothing has been applied yet, mirroring `voidCreditNote`. */
  async voidVendorCredit(
    context: OrganizationContext,
    user: PublicUser,
    vendorCreditId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, vendorCreditId);
    if (existing.status !== 'ISSUED') {
      throw new ConflictException('Only issued vendor credits can be voided.');
    }
    if (existing.remainingMinor !== existing.totalMinor) {
      throw new ConflictException('A vendor credit with allocations applied cannot be voided.');
    }
    if (!existing.journalId) {
      throw new ConflictException('This vendor credit has no posted journal to reverse.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseJournal(
        context,
        user,
        existing.journalId!,
        { description: `Void of vendor credit ${existing.vendorCreditNumber ?? existing.id}` },
        metadata,
        undefined,
        tx,
      );

      const vendorCredit = await tx.vendorCredit.update({
        where: { id: vendorCreditId },
        data: { status: 'VOID', voidedAt: new Date() },
        include: vendorCreditDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.vendor_credit_voided',
        entityType: 'vendor_credit',
        entityId: vendorCreditId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: 'VOID' },
        ipHash: metadata.ipHash,
      });

      return vendorCredit;
    });

    return summarizeVendorCredit(updated);
  }

  async openBillsFor(organizationId: string, vendorCreditId: string) {
    const vendorCredit = await this.findOrThrow(organizationId, vendorCreditId);
    const bills = await this.prisma.bill.findMany({
      where: {
        organizationId,
        vendorId: vendorCredit.vendorId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        balanceMinor: { gt: 0n },
      },
      orderBy: [{ issueDate: 'asc' }],
      select: {
        id: true,
        billNumber: true,
        issueDate: true,
        dueDate: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        balanceMinor: true,
      },
    });
    return bills.map((bill) => ({
      id: bill.id,
      billNumber: bill.billNumber,
      issueDate: bill.issueDate ? dateOnly(bill.issueDate) : null,
      dueDate: bill.dueDate ? dateOnly(bill.dueDate) : null,
      currency: bill.currency,
      totalMinor: bill.totalMinor.toString(),
      paidMinor: bill.paidMinor.toString(),
      balanceMinor: bill.balanceMinor.toString(),
    }));
  }

  /**
   * Applies an issued vendor credit's remaining balance against one or more open bills. Posts a
   * real journal (`DR accounts_payable, CR vendor_credit`) *per bill*. Locking mirrors
   * `CreditNotesService#allocate` exactly: vendor-credit row first, then bill rows in ascending id
   * order, balances re-read only after both locks are held, both invariants checked before any
   * write. **The per-bill guard compares `amount` directly against the freshly re-read
   * `bill.balanceMinor` -- never `existingAllocationFromThisVendorCredit + amount` -- since
   * `balanceMinor` is already net of every prior allocation against that bill from any source.**
   */
  async allocate(
    context: OrganizationContext,
    user: PublicUser,
    vendorCreditId: string,
    input: AllocateVendorCreditDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const requestedByBill = new Map<string, bigint>();
    for (const line of input.allocations) {
      if (requestedByBill.has(line.billId)) {
        throw new BadRequestException(
          `Bill ${line.billId} appears more than once in this allocation request.`,
        );
      }
      const amount = BigInt(line.amountMinor);
      if (amount <= 0n) {
        throw new BadRequestException('Each allocation amount must be greater than zero.');
      }
      requestedByBill.set(line.billId, amount);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockVendorCreditIdempotency(
        tx,
        context.id,
        'VENDOR_CREDIT_ALLOCATE',
        idempotencyKey,
      );
      const existingResult = await this.findVendorCreditIdempotentResult(
        context.id,
        'VENDOR_CREDIT_ALLOCATE',
        idempotencyKey,
        tx,
      );
      if (existingResult) {
        return tx.vendorCredit.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: vendorCreditDetailInclude,
        });
      }

      await this.lockVendorCreditRow(tx, context.id, vendorCreditId);
      const vendorCredit = await tx.vendorCredit.findFirst({
        where: { id: vendorCreditId, organizationId: context.id },
        include: { vendor: { select: { payableAccountId: true, displayName: true } } },
      });
      if (!vendorCredit) throw new NotFoundException('Vendor credit not found.');
      if (vendorCredit.status !== 'ISSUED') {
        throw new ConflictException('This vendor credit has no remaining balance to allocate.');
      }

      const sortedBillIds = [...requestedByBill.keys()].sort();
      await this.lockBillRowsInOrder(tx, context.id, sortedBillIds);
      const bills = await tx.bill.findMany({
        where: { id: { in: sortedBillIds }, organizationId: context.id },
      });
      const billsById = new Map(bills.map((bill) => [bill.id, bill]));
      for (const billId of sortedBillIds) {
        const bill = billsById.get(billId);
        if (!bill) throw new NotFoundException(`Bill ${billId} not found.`);
        if (bill.vendorId !== vendorCredit.vendorId) {
          throw new ConflictException(
            `Bill ${billId} does not belong to this vendor credit's vendor.`,
          );
        }
        if (bill.status !== 'ISSUED' && bill.status !== 'PARTIALLY_PAID') {
          throw new ConflictException(`Bill ${billId} is not open for allocation.`);
        }
      }

      const totalRequestedMinor = [...requestedByBill.values()].reduce(
        (sum, amount) => sum + amount,
        0n,
      );
      if (totalRequestedMinor > vendorCredit.remainingMinor) {
        throw new ConflictException(
          "Allocation total exceeds the vendor credit's remaining balance.",
        );
      }
      for (const [billId, amount] of requestedByBill) {
        const bill = billsById.get(billId)!;
        if (amount > bill.balanceMinor) {
          throw new ConflictException(
            `Allocation for bill ${billId} exceeds its remaining balance.`,
          );
        }
      }

      const vendorCreditAccount = await this.ledger.accountBySystemKey(
        context.id,
        'vendor_credit',
        tx,
      );
      const apAccount = vendorCredit.vendor.payableAccountId
        ? await tx.ledgerAccount.findUniqueOrThrow({
            where: { id: vendorCredit.vendor.payableAccountId },
          })
        : await this.ledger.accountBySystemKey(context.id, 'accounts_payable', tx);
      const today = new Date(`${dateOnly(new Date())}T00:00:00.000Z`);

      for (const [billId, amount] of requestedByBill) {
        const bill = billsById.get(billId)!;
        const postedJournal = await this.ledger.postJournalFromLines(
          context,
          user,
          'VENDOR_CREDIT_ALLOCATE',
          {
            journalDate: today,
            currency: vendorCredit.currency,
            description: `Vendor credit ${vendorCredit.vendorCreditNumber ?? vendorCredit.id} applied to bill ${bill.billNumber ?? bill.id}`,
            sourceType: 'VENDOR_CREDIT_ALLOCATION',
            sourceId: vendorCreditId,
            lines: [
              { accountId: apAccount.id, debitMinor: amount, creditMinor: 0n },
              { accountId: vendorCreditAccount.id, debitMinor: 0n, creditMinor: amount },
            ],
          },
          metadata,
          undefined,
          tx,
        );

        await tx.vendorCreditAllocation.create({
          data: {
            organizationId: context.id,
            vendorCreditId,
            billId,
            amountMinor: amount,
            journalId: postedJournal.id,
          },
        });

        const newBalanceMinor = bill.balanceMinor - amount;
        await tx.bill.update({
          where: { id: billId },
          data: {
            paidMinor: bill.paidMinor + amount,
            balanceMinor: newBalanceMinor,
            status: newBalanceMinor === 0n ? 'PAID' : 'PARTIALLY_PAID',
          },
        });
      }

      const newRemainingMinor = vendorCredit.remainingMinor - totalRequestedMinor;
      const updatedVendorCredit = await tx.vendorCredit.update({
        where: { id: vendorCreditId },
        data: {
          appliedMinor: vendorCredit.appliedMinor + totalRequestedMinor,
          remainingMinor: newRemainingMinor,
          status: newRemainingMinor === 0n ? 'APPLIED' : 'ISSUED',
        },
        include: vendorCreditDetailInclude,
      });

      await this.recordVendorCreditIdempotency(
        tx,
        context.id,
        'VENDOR_CREDIT_ALLOCATE',
        idempotencyKey,
        vendorCreditId,
      );
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.vendor_credit_allocated',
        entityType: 'vendor_credit',
        entityId: vendorCreditId,
        action: AuditAction.UPDATE,
        after: { totalRequestedMinor: totalRequestedMinor.toString(), billIds: sortedBillIds },
        ipHash: metadata.ipHash,
      });

      return updatedVendorCredit;
    });

    return summarizeVendorCredit(updated);
  }

  private async findOrThrow(organizationId: string, vendorCreditId: string) {
    const vendorCredit = await this.prisma.vendorCredit.findFirst({
      where: { id: vendorCreditId, organizationId },
      include: vendorCreditDetailInclude,
    });
    if (!vendorCredit) throw new NotFoundException('Vendor credit not found.');
    return vendorCredit;
  }

  private async resolveLines(organizationId: string, lines: readonly VendorCreditLineDto[]) {
    const itemIds = Array.from(
      new Set(lines.map((line) => line.itemId).filter((id): id is string => Boolean(id))),
    );
    const items =
      itemIds.length === 0
        ? []
        : await this.prisma.item.findMany({ where: { id: { in: itemIds }, organizationId } });
    const itemsById = new Map(items.map((item) => [item.id, item]));

    return lines.map((line, index) => {
      const label = `Line ${index + 1}`;
      const item = line.itemId ? itemsById.get(line.itemId) : undefined;
      if (line.itemId && !item) throw new BadRequestException(`${label}: item not found.`);
      if (item && item.status !== 'ACTIVE') {
        throw new BadRequestException(`${label}: item is not active.`);
      }

      const descriptionOverrideAllowed = !item || item.freeDescriptionAllowed;
      if (!item && !line.description) {
        throw new BadRequestException(`${label}: needs a description or an item.`);
      }
      if (item && line.description && !descriptionOverrideAllowed) {
        throw new BadRequestException(
          `${label}: this item does not allow a free-text description.`,
        );
      }
      const descriptionSnapshot = line.description ?? item?.name;
      if (!descriptionSnapshot) throw new BadRequestException(`${label}: needs a description.`);

      const unitPriceMinor = BigInt(line.unitPriceMinor);
      const discountMinor = line.discountMinor ? BigInt(line.discountMinor) : 0n;
      const lineTotalMinor = computeLineTotal(label, line.quantity, unitPriceMinor, discountMinor);

      return {
        itemId: item?.id ?? null,
        descriptionSnapshot,
        quantity: line.quantity,
        unitPriceMinor,
        discountMinor,
        lineTotalMinor,
        taxCodeId: line.taxCodeId ?? null,
        accountId: line.accountId ?? null,
        projectTag: line.projectTag ?? null,
      };
    });
  }

  private async lockVendorCreditIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: string,
    key?: string,
  ): Promise<void> {
    if (!key) return;
    const lockKey = `${organizationId}:${operation}:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private async findVendorCreditIdempotentResult(
    organizationId: string,
    operation: string,
    key: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return tx.ledgerIdempotencyKey.findUnique({
      where: { organizationId_operation_key: { organizationId, operation, key } },
      select: { resourceId: true },
    });
  }

  private recordVendorCreditIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    operation: string,
    key: string | undefined,
    vendorCreditId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation,
        key,
        resourceType: 'VENDOR_CREDIT',
        resourceId: vendorCreditId,
      },
    });
  }

  private async lockVendorCreditRow(
    tx: Prisma.TransactionClient,
    organizationId: string,
    vendorCreditId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM vendor_credits
      WHERE id = ${vendorCreditId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;
  }

  private async lockBillRowsInOrder(
    tx: Prisma.TransactionClient,
    organizationId: string,
    billIds: readonly string[],
  ): Promise<void> {
    if (billIds.length === 0) return;
    await tx.$queryRaw`
      SELECT id
      FROM bills
      WHERE id = ANY(${billIds}::uuid[]) AND organization_id = ${organizationId}::uuid
      ORDER BY id
      FOR UPDATE
    `;
  }
}

function computeLineTotal(
  label: string,
  quantity: string,
  unitPriceMinor: bigint,
  discountMinor: bigint,
): bigint {
  const [whole = '0', fraction = ''] = quantity.split('.');
  const quantityScaled = BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(4, '0'));
  if (quantityScaled <= 0n)
    throw new BadRequestException(`${label}: quantity must be greater than zero.`);
  const gross = roundHalfUpDivide(quantityScaled * unitPriceMinor, QUANTITY_SCALE);
  const total = gross - discountMinor;
  if (total < 0n) {
    throw new BadRequestException(`${label}: discount cannot exceed the line's gross amount.`);
  }
  return total;
}

function lineTotals(lines: readonly { lineTotalMinor: bigint }[]) {
  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0n);
  return { subtotalMinor, taxTotalMinor: 0n, totalMinor: subtotalMinor };
}

function lineCreateData(
  line: {
    itemId: string | null;
    descriptionSnapshot: string;
    quantity: string;
    unitPriceMinor: bigint;
    discountMinor: bigint;
    lineTotalMinor: bigint;
    taxCodeId: string | null;
    accountId: string | null;
    projectTag: string | null;
  },
  index: number,
  organizationId: string,
) {
  return {
    organizationId,
    lineNumber: index + 1,
    itemId: line.itemId,
    descriptionSnapshot: line.descriptionSnapshot,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    discountMinor: line.discountMinor,
    lineTotalMinor: line.lineTotalMinor,
    taxCodeId: line.taxCodeId,
    accountId: line.accountId,
    projectTag: line.projectTag,
  };
}

function summarizeVendorCredit(vendorCredit: VendorCreditWithDetail) {
  return {
    id: vendorCredit.id,
    vendorId: vendorCredit.vendorId,
    vendorName: vendorCredit.vendor.displayName,
    sourceBillId: vendorCredit.sourceBillId,
    reason: vendorCredit.reason,
    vendorCreditNumber: vendorCredit.vendorCreditNumber,
    status: vendorCredit.status,
    issueDate: vendorCredit.issueDate ? dateOnly(vendorCredit.issueDate) : null,
    currency: vendorCredit.currency,
    subtotalMinor: vendorCredit.subtotalMinor.toString(),
    taxTotalMinor: vendorCredit.taxTotalMinor.toString(),
    totalMinor: vendorCredit.totalMinor.toString(),
    appliedMinor: vendorCredit.appliedMinor.toString(),
    remainingMinor: vendorCredit.remainingMinor.toString(),
    journalId: vendorCredit.journalId,
    voidedAt: vendorCredit.voidedAt?.toISOString() ?? null,
    lines: vendorCredit.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      descriptionSnapshot: line.descriptionSnapshot,
      quantity: line.quantity.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
      taxCodeId: line.taxCodeId,
      taxCodeSnapshot: line.taxCodeSnapshot,
      taxTreatmentSnapshot: line.taxTreatmentSnapshot,
      taxRecoverableSnapshot: line.taxRecoverableSnapshot,
      taxRatePercentSnapshot: line.taxRatePercentSnapshot?.toString() ?? null,
      taxableAmountMinor: line.taxableAmountMinor?.toString() ?? null,
      taxAmountMinor: line.taxAmountMinor?.toString() ?? null,
      accountId: line.accountId,
      projectTag: line.projectTag,
    })),
    allocations: vendorCredit.allocations.map((allocation) => ({
      id: allocation.id,
      vendorCreditId: allocation.vendorCreditId,
      billId: allocation.billId,
      billNumber: allocation.bill.billNumber,
      amountMinor: allocation.amountMinor.toString(),
      journalId: allocation.journalId,
      createdAt: allocation.createdAt.toISOString(),
    })),
    createdAt: vendorCredit.createdAt.toISOString(),
    updatedAt: vendorCredit.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
