import { ConflictException } from '@nestjs/common';
import type { ApprovalTargetType, Prisma } from '@prisma/client';

import type { PermissionKey } from '../organizations/permission-catalog.js';

/**
 * A frozen, organization-scoped view of the document an approval request was submitted against.
 * `updatedAt` becomes the request's `targetVersion` -- the value a later decision is checked
 * against to detect that the underlying document changed after submission.
 */
export type ApprovalTargetSnapshot = {
  type: ApprovalTargetType;
  id: string;
  updatedAt: Date;
  amountMinor?: bigint;
  tagId?: string | null;
  projectId?: string | null;
  summary: Prisma.InputJsonObject;
};

/**
 * The permission a caller must hold on the target's own module to submit it for approval -- the
 * same "can write this document" permission its create/update endpoints require, not the
 * finalize/issue permission that action still separately enforces once approval clears.
 */
export const APPROVAL_TARGET_NATIVE_PERMISSION: Record<ApprovalTargetType, PermissionKey> = {
  QUOTE: 'sales.quotes.manage',
  SALES_ORDER: 'sales.orders.manage',
  INVOICE: 'sales.invoices.manage',
  CREDIT_NOTE: 'sales.credit_notes.manage',
  PURCHASE_ORDER: 'purchases.orders.manage',
  BILL: 'purchases.bills.manage',
  PAYMENT_MADE: 'purchases.payments_made.record',
  INVENTORY_ADJUSTMENT: 'inventory.adjustments.manage',
  JOURNAL: 'journals.create',
};

type Executor = Prisma.TransactionClient;

async function findPendingApprovalId(
  tx: Executor,
  organizationId: string,
  targetType: ApprovalTargetType,
  targetId: string,
): Promise<string | null> {
  const pending = await tx.approvalRequest.findFirst({
    where: { organizationId, targetType, targetId, status: 'PENDING' },
    select: { id: true },
  });
  return pending?.id ?? null;
}

/** Blocks a target's finalize/post action while an approval request against it is still pending. */
export async function assertNoPendingApproval(
  tx: Executor,
  organizationId: string,
  targetType: ApprovalTargetType,
  targetId: string,
): Promise<void> {
  if (await findPendingApprovalId(tx, organizationId, targetType, targetId)) {
    throw new ConflictException('This document is awaiting approval and cannot be finalized.');
  }
}

/** Blocks a second approval submission while one is already pending for the same target. */
export async function assertNoDuplicatePendingApproval(
  tx: Executor,
  organizationId: string,
  targetType: ApprovalTargetType,
  targetId: string,
): Promise<void> {
  if (await findPendingApprovalId(tx, organizationId, targetType, targetId)) {
    throw new ConflictException('This document already has a pending approval request.');
  }
}

/**
 * Loads the live target row and builds a fresh snapshot, scoped to the organization. Returns
 * `null` when the target does not exist (or belongs to a different organization) -- callers treat
 * that as "not found" at submission time and as "stale" when re-checked at decision time.
 *
 * None of the nine target types carries a header-level tag or project column -- both are recorded
 * per line (`JournalLine.tagId`/`JournalLine.projectId`) where a single document can span several
 * of each -- so `tagId`/`projectId` are left unset here. A policy conditioned on `tagIds` or
 * `projectIds` therefore never matches today; that is a known limitation of the schema, not a bug
 * in this resolver.
 */
export async function loadApprovalTarget(
  tx: Executor,
  organizationId: string,
  targetType: ApprovalTargetType,
  targetId: string,
): Promise<ApprovalTargetSnapshot | null> {
  switch (targetType) {
    case 'QUOTE': {
      const quote = await tx.quote.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          totalMinor: true,
          currency: true,
          quoteNumber: true,
          status: true,
          contact: { select: { displayName: true } },
        },
      });
      if (!quote) return null;
      return {
        type: targetType,
        id: quote.id,
        updatedAt: quote.updatedAt,
        amountMinor: quote.totalMinor,
        summary: {
          documentNumber: quote.quoteNumber,
          status: quote.status,
          currency: quote.currency,
          totalMinor: quote.totalMinor.toString(),
          contactName: quote.contact.displayName,
        },
      };
    }
    case 'SALES_ORDER': {
      const order = await tx.salesOrder.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          totalMinor: true,
          currency: true,
          orderNumber: true,
          status: true,
          contact: { select: { displayName: true } },
        },
      });
      if (!order) return null;
      return {
        type: targetType,
        id: order.id,
        updatedAt: order.updatedAt,
        amountMinor: order.totalMinor,
        summary: {
          documentNumber: order.orderNumber,
          status: order.status,
          currency: order.currency,
          totalMinor: order.totalMinor.toString(),
          contactName: order.contact.displayName,
        },
      };
    }
    case 'INVOICE': {
      const invoice = await tx.invoice.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          totalMinor: true,
          currency: true,
          invoiceNumber: true,
          status: true,
          contact: { select: { displayName: true } },
        },
      });
      if (!invoice) return null;
      return {
        type: targetType,
        id: invoice.id,
        updatedAt: invoice.updatedAt,
        amountMinor: invoice.totalMinor,
        summary: {
          documentNumber: invoice.invoiceNumber,
          status: invoice.status,
          currency: invoice.currency,
          totalMinor: invoice.totalMinor.toString(),
          contactName: invoice.contact.displayName,
        },
      };
    }
    case 'CREDIT_NOTE': {
      const creditNote = await tx.creditNote.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          totalMinor: true,
          currency: true,
          creditNoteNumber: true,
          status: true,
          contact: { select: { displayName: true } },
        },
      });
      if (!creditNote) return null;
      return {
        type: targetType,
        id: creditNote.id,
        updatedAt: creditNote.updatedAt,
        amountMinor: creditNote.totalMinor,
        summary: {
          documentNumber: creditNote.creditNoteNumber,
          status: creditNote.status,
          currency: creditNote.currency,
          totalMinor: creditNote.totalMinor.toString(),
          contactName: creditNote.contact.displayName,
        },
      };
    }
    case 'PURCHASE_ORDER': {
      const order = await tx.purchaseOrder.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          totalMinor: true,
          currency: true,
          orderNumber: true,
          status: true,
          vendor: { select: { displayName: true } },
        },
      });
      if (!order) return null;
      return {
        type: targetType,
        id: order.id,
        updatedAt: order.updatedAt,
        amountMinor: order.totalMinor,
        summary: {
          documentNumber: order.orderNumber,
          status: order.status,
          currency: order.currency,
          totalMinor: order.totalMinor.toString(),
          vendorName: order.vendor.displayName,
        },
      };
    }
    case 'BILL': {
      const bill = await tx.bill.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          totalMinor: true,
          currency: true,
          billNumber: true,
          status: true,
          vendor: { select: { displayName: true } },
        },
      });
      if (!bill) return null;
      return {
        type: targetType,
        id: bill.id,
        updatedAt: bill.updatedAt,
        amountMinor: bill.totalMinor,
        summary: {
          documentNumber: bill.billNumber,
          status: bill.status,
          currency: bill.currency,
          totalMinor: bill.totalMinor.toString(),
          vendorName: bill.vendor.displayName,
        },
      };
    }
    case 'PAYMENT_MADE': {
      const payment = await tx.paymentMade.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          amountMinor: true,
          currency: true,
          paymentNumber: true,
          status: true,
          vendor: { select: { displayName: true } },
        },
      });
      if (!payment) return null;
      return {
        type: targetType,
        id: payment.id,
        updatedAt: payment.updatedAt,
        amountMinor: payment.amountMinor,
        summary: {
          documentNumber: payment.paymentNumber,
          status: payment.status,
          currency: payment.currency,
          amountMinor: payment.amountMinor.toString(),
          vendorName: payment.vendor.displayName,
        },
      };
    }
    case 'INVENTORY_ADJUSTMENT': {
      const adjustment = await tx.inventoryAdjustment.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          valueDeltaMinor: true,
          quantityDelta: true,
          reason: true,
          status: true,
          item: { select: { name: true } },
          warehouse: { select: { name: true } },
        },
      });
      if (!adjustment) return null;
      const amountMinor =
        adjustment.valueDeltaMinor < 0n ? -adjustment.valueDeltaMinor : adjustment.valueDeltaMinor;
      return {
        type: targetType,
        id: adjustment.id,
        updatedAt: adjustment.updatedAt,
        amountMinor,
        summary: {
          status: adjustment.status,
          reason: adjustment.reason,
          quantityDelta: adjustment.quantityDelta.toString(),
          valueDeltaMinor: adjustment.valueDeltaMinor.toString(),
          itemName: adjustment.item.name,
          warehouseName: adjustment.warehouse.name,
        },
      };
    }
    case 'JOURNAL': {
      const journal = await tx.journal.findFirst({
        where: { id: targetId, organizationId },
        select: {
          id: true,
          updatedAt: true,
          currency: true,
          reference: true,
          description: true,
          status: true,
        },
      });
      if (!journal) return null;
      const totals = await tx.journalLine.aggregate({
        where: { journalId: journal.id },
        _sum: { debitMinor: true },
      });
      const amountMinor = totals._sum.debitMinor ?? 0n;
      return {
        type: targetType,
        id: journal.id,
        updatedAt: journal.updatedAt,
        amountMinor,
        summary: {
          documentNumber: journal.reference,
          status: journal.status,
          currency: journal.currency,
          description: journal.description,
          totalMinor: amountMinor.toString(),
        },
      };
    }
    default: {
      const exhaustive: never = targetType;
      throw new Error(`Unsupported approval target type: ${exhaustive as string}`);
    }
  }
}

/** Cheap re-fetch used by `ApprovalsService#decide` to detect that the target changed since submission. */
export async function currentApprovalTargetVersion(
  tx: Executor,
  organizationId: string,
  targetType: ApprovalTargetType,
  targetId: string,
): Promise<Date | null> {
  const target = await loadApprovalTarget(tx, organizationId, targetType, targetId);
  return target?.updatedAt ?? null;
}
