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
import { BILL_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { TaxService } from '../organizations/tax.service.js';
import type { BillLineDto, CreateBillDto, UpdateBillDto } from './bills.dto.js';

const QUANTITY_SCALE = 10_000n;

type BillWithLines = Prisma.BillGetPayload<{ include: typeof billDetailInclude }>;

const billDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  vendor: {
    select: { id: true, displayName: true, currency: true, payableAccountId: true },
  },
} satisfies Prisma.BillInclude;

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly tax: TaxService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async list(organizationId: string, status?: string) {
    const bills = await this.prisma.bill.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: billDetailInclude,
      take: 200,
    });
    return bills.map(summarizeBill);
  }

  async detail(organizationId: string, billId: string) {
    const bill = await this.findOrThrow(organizationId, billId);
    return summarizeBill(bill);
  }

  async createDraft(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateBillDto,
    metadata: RequestMetadata,
  ) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: input.vendorId, organizationId: context.id },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');
    if (vendor.status !== 'ACTIVE') {
      throw new ConflictException('Cannot bill a deactivated vendor.');
    }
    if (input.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: input.purchaseOrderId, organizationId: context.id },
      });
      if (!po) throw new NotFoundException('Purchase order not found.');
    }
    const currency = input.currency ?? vendor.currency;
    const resolvedLines = await this.resolveLines(context.id, input.lines);
    const totals = lineTotals(resolvedLines);

    const created = await this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          organizationId: context.id,
          vendorId: vendor.id,
          purchaseOrderId: input.purchaseOrderId ?? null,
          vendorReference: input.vendorReference ?? null,
          currency,
          dueDate: input.dueDate ? isoDate(input.dueDate) : null,
          subtotalMinor: totals.subtotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          totalMinor: totals.totalMinor,
          balanceMinor: 0n,
          createdByUserId: user.id,
          lines: {
            create: resolvedLines.map((line, index) => lineCreateData(line, index, context.id)),
          },
        },
        include: billDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.bill_created',
        entityType: 'bill',
        entityId: bill.id,
        action: AuditAction.CREATE,
        after: { vendorId: vendor.id, totalMinor: totals.totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return bill;
    });

    return summarizeBill(created);
  }

  async updateDraft(
    context: OrganizationContext,
    user: PublicUser,
    billId: string,
    input: UpdateBillDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, billId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft bills can be edited.');
    }

    let vendor = existing.vendor;
    if (input.vendorId && input.vendorId !== existing.vendorId) {
      const nextVendor = await this.prisma.vendor.findFirst({
        where: { id: input.vendorId, organizationId: context.id },
      });
      if (!nextVendor) throw new NotFoundException('Vendor not found.');
      if (nextVendor.status !== 'ACTIVE') {
        throw new ConflictException('Cannot bill a deactivated vendor.');
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
        await tx.billLine.deleteMany({ where: { billId } });
      }
      const bill = await tx.bill.update({
        where: { id: billId },
        data: {
          vendorId: vendor.id,
          currency,
          ...(input.purchaseOrderId !== undefined
            ? { purchaseOrderId: input.purchaseOrderId || null }
            : {}),
          ...(input.vendorReference !== undefined
            ? { vendorReference: input.vendorReference }
            : {}),
          dueDate: input.dueDate !== undefined ? isoDate(input.dueDate) : existing.dueDate,
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
        include: billDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.bill_updated',
        entityType: 'bill',
        entityId: billId,
        action: AuditAction.UPDATE,
        before: { totalMinor: existing.totalMinor.toString() },
        after: { totalMinor: totals.totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return bill;
    });

    return summarizeBill(updated);
  }

  /**
   * Issues a draft bill: freezes each line's tax snapshot, consolidates lines by account (one AP
   * credit, one expense/inventory/asset debit per distinct account, one recoverable-tax debit per
   * distinct tax code), and posts through `LedgerService.postJournalFromLines` -- mirrors
   * `InvoicesService#issueInvoice` exactly, sign-flipped (credit AP instead of debit AR, debit
   * expense/tax instead of credit revenue/tax). If this bill references a Purchase Order, that
   * order's `billedMinor` is incremented in the same transaction.
   */
  async issueBill(
    context: OrganizationContext,
    user: PublicUser,
    billId: string,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const issued = await this.prisma.$transaction(async (tx) => {
      await this.lockBillIdempotency(tx, context.id, idempotencyKey);
      const existingResult = await this.findBillIdempotentResult(context.id, idempotencyKey, tx);
      if (existingResult) {
        return tx.bill.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: billDetailInclude,
        });
      }

      await this.lockBillRow(tx, context.id, billId);
      const bill = await tx.bill.findFirst({
        where: { id: billId, organizationId: context.id },
        include: billDetailInclude,
      });
      if (!bill) throw new NotFoundException('Bill not found.');
      if (bill.status !== 'DRAFT') {
        throw new ConflictException('Only draft bills can be issued.');
      }
      if (bill.lines.length === 0) {
        throw new BadRequestException('A bill needs at least one line before it can be issued.');
      }

      const issueDate = dateOnly(new Date());

      const apAccount = bill.vendor.payableAccountId
        ? await tx.ledgerAccount.findUniqueOrThrow({ where: { id: bill.vendor.payableAccountId } })
        : await this.ledger.accountBySystemKey(context.id, 'accounts_payable', tx);

      const expenseByAccount = new Map<string, bigint>();
      const taxByCode = new Map<string, { accountId: string; amountMinor: bigint }>();
      let subtotalMinor = 0n;
      let taxTotalMinor = 0n;

      for (const line of bill.lines) {
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
          await tx.billLine.update({
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
        throw new BadRequestException('A bill total must be greater than zero.');
      }

      const journalLines = [
        {
          accountId: apAccount.id,
          debitMinor: 0n,
          creditMinor: totalMinor,
          description: `Bill from ${bill.vendor.displayName}`,
        },
        ...[...expenseByAccount.entries()].map(([accountId, amountMinor]) => ({
          accountId,
          debitMinor: amountMinor,
          creditMinor: 0n,
          description: `Bill from ${bill.vendor.displayName}`,
        })),
        ...[...taxByCode.values()].map((entry) => ({
          accountId: entry.accountId,
          debitMinor: entry.amountMinor,
          creditMinor: 0n,
          description: `Bill recoverable tax from ${bill.vendor.displayName}`,
        })),
      ];

      const postedJournal = await this.ledger.postJournalFromLines(
        context,
        user,
        'BILL_ISSUE',
        {
          journalDate: new Date(`${issueDate}T00:00:00.000Z`),
          currency: bill.currency,
          description: `Bill from ${bill.vendor.displayName}`,
          sourceType: 'BILL',
          sourceId: bill.id,
          lines: journalLines,
        },
        metadata,
        undefined,
        tx,
      );

      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        BILL_DOCUMENT_TYPE,
        new Date(`${issueDate}T00:00:00.000Z`),
      );

      const updated = await tx.bill.update({
        where: { id: billId },
        data: {
          status: 'ISSUED',
          billNumber: allocation.value,
          issueDate: isoDate(issueDate),
          subtotalMinor,
          taxTotalMinor,
          totalMinor,
          balanceMinor: totalMinor,
          journalId: postedJournal.id,
        },
        include: billDetailInclude,
      });

      if (bill.purchaseOrderId) {
        await tx.purchaseOrder.update({
          where: { id: bill.purchaseOrderId },
          data: { billedMinor: { increment: totalMinor } },
        });
      }

      await this.recordBillIdempotency(tx, context.id, idempotencyKey, billId);
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.bill_issued',
        entityType: 'bill',
        entityId: billId,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: { status: 'ISSUED', billNumber: allocation.value },
        ipHash: metadata.ipHash,
      });

      return updated;
    });

    return summarizeBill(issued);
  }

  /**
   * Voids an issued (or partially paid) bill with no payments applied yet, reversing its posting
   * journal -- mirrors `InvoicesService#voidInvoice` exactly. A bill with any `paidMinor` must be
   * corrected through a Vendor Credit instead (Milestone 3E); cash has already moved.
   */
  async voidBill(
    context: OrganizationContext,
    user: PublicUser,
    billId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, billId);
    if (existing.status !== 'ISSUED' && existing.status !== 'PARTIALLY_PAID') {
      throw new ConflictException('Only issued bills can be voided.');
    }
    if (existing.paidMinor > 0n) {
      throw new ConflictException(
        'A bill with payments applied cannot be voided; issue a vendor credit instead.',
      );
    }
    if (!existing.journalId) {
      throw new ConflictException('This bill has no posted journal to reverse.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseJournal(
        context,
        user,
        existing.journalId!,
        { description: `Void of bill ${existing.billNumber ?? existing.id}` },
        metadata,
        undefined,
        tx,
      );

      const bill = await tx.bill.update({
        where: { id: billId },
        data: { status: 'VOID', voidedAt: new Date() },
        include: billDetailInclude,
      });

      if (bill.purchaseOrderId) {
        await tx.purchaseOrder.update({
          where: { id: bill.purchaseOrderId },
          data: { billedMinor: { decrement: existing.totalMinor } },
        });
      }

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.bill_voided',
        entityType: 'bill',
        entityId: billId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: 'VOID' },
        ipHash: metadata.ipHash,
      });

      return bill;
    });

    return summarizeBill(updated);
  }

  private async findOrThrow(organizationId: string, billId: string) {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, organizationId },
      include: billDetailInclude,
    });
    if (!bill) throw new NotFoundException('Bill not found.');
    return bill;
  }

  private async resolveLines(organizationId: string, lines: readonly BillLineDto[]) {
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
        purchaseOrderLineId: line.purchaseOrderLineId ?? null,
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

  private async lockBillIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key?: string,
  ): Promise<void> {
    if (!key) return;
    const lockKey = `${organizationId}:BILL_ISSUE:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private async findBillIdempotentResult(
    organizationId: string,
    key: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return tx.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: { organizationId, operation: 'BILL_ISSUE_BILL', key },
      },
      select: { resourceId: true },
    });
  }

  private recordBillIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key: string | undefined,
    billId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation: 'BILL_ISSUE_BILL',
        key,
        resourceType: 'BILL',
        resourceId: billId,
      },
    });
  }

  private async lockBillRow(
    tx: Prisma.TransactionClient,
    organizationId: string,
    billId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM bills
      WHERE id = ${billId}::uuid AND organization_id = ${organizationId}::uuid
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
  // Draft totals are pre-tax previews only; tax is computed and frozen at issue time.
  return { subtotalMinor, taxTotalMinor: 0n, totalMinor: subtotalMinor };
}

function lineCreateData(
  line: {
    itemId: string | null;
    purchaseOrderLineId: string | null;
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
    purchaseOrderLineId: line.purchaseOrderLineId,
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

function summarizeBill(bill: BillWithLines) {
  return {
    id: bill.id,
    vendorId: bill.vendorId,
    vendorName: bill.vendor.displayName,
    purchaseOrderId: bill.purchaseOrderId,
    billNumber: bill.billNumber,
    vendorReference: bill.vendorReference,
    status: bill.status,
    issueDate: bill.issueDate ? dateOnly(bill.issueDate) : null,
    dueDate: bill.dueDate ? dateOnly(bill.dueDate) : null,
    currency: bill.currency,
    exchangeRate: bill.exchangeRate?.toString() ?? null,
    subtotalMinor: bill.subtotalMinor.toString(),
    taxTotalMinor: bill.taxTotalMinor.toString(),
    totalMinor: bill.totalMinor.toString(),
    paidMinor: bill.paidMinor.toString(),
    balanceMinor: bill.balanceMinor.toString(),
    journalId: bill.journalId,
    voidedAt: bill.voidedAt?.toISOString() ?? null,
    lines: bill.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      purchaseOrderLineId: line.purchaseOrderLineId,
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
    createdAt: bill.createdAt.toISOString(),
    updatedAt: bill.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
