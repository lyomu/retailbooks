import { NotFoundException } from '@nestjs/common';
import type { CollaborationTargetType } from '@prisma/client';

import type { PrismaService } from '../database/prisma.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';

type TargetDefinition = {
  delegate: string;
  viewPermission: string;
  managePermission: string;
  customerEligible?: boolean;
};

/** One registry is the only way comments/files/activity learn what a target is. */
const TARGETS: Record<CollaborationTargetType, TargetDefinition> = {
  QUOTE: {
    delegate: 'quote',
    viewPermission: 'sales.quotes.view',
    managePermission: 'sales.quotes.manage',
    customerEligible: true,
  },
  SALES_ORDER: {
    delegate: 'salesOrder',
    viewPermission: 'sales.orders.view',
    managePermission: 'sales.orders.manage',
    customerEligible: true,
  },
  INVOICE: {
    delegate: 'invoice',
    viewPermission: 'sales.invoices.view',
    managePermission: 'sales.invoices.manage',
    customerEligible: true,
  },
  CREDIT_NOTE: {
    delegate: 'creditNote',
    viewPermission: 'sales.credit_notes.view',
    managePermission: 'sales.credit_notes.manage',
    customerEligible: true,
  },
  PAYMENT_RECEIVED: {
    delegate: 'paymentReceived',
    viewPermission: 'sales.payments.view',
    managePermission: 'sales.payments.record',
    customerEligible: true,
  },
  PURCHASE_ORDER: {
    delegate: 'purchaseOrder',
    viewPermission: 'purchases.orders.view',
    managePermission: 'purchases.orders.manage',
  },
  BILL: {
    delegate: 'bill',
    viewPermission: 'purchases.bills.view',
    managePermission: 'purchases.bills.manage',
  },
  EXPENSE: {
    delegate: 'expense',
    viewPermission: 'purchases.expenses.view',
    managePermission: 'purchases.expenses.manage',
  },
  VENDOR_CREDIT: {
    delegate: 'vendorCredit',
    viewPermission: 'purchases.vendor_credits.view',
    managePermission: 'purchases.vendor_credits.manage',
  },
  PAYMENT_MADE: {
    delegate: 'paymentMade',
    viewPermission: 'purchases.payments_made.view',
    managePermission: 'purchases.payments_made.record',
  },
  JOURNAL: {
    delegate: 'journal',
    viewPermission: 'journals.view',
    managePermission: 'journals.create',
  },
  OPENING_BALANCE_BATCH: {
    delegate: 'openingBalanceBatch',
    viewPermission: 'accounts.view',
    managePermission: 'accounts.opening_balances.manage',
  },
  BANK_TRANSACTION: {
    delegate: 'bankTransaction',
    viewPermission: 'banking.transactions.view',
    managePermission: 'banking.transactions.manage',
  },
  TRANSFER: {
    delegate: 'transfer',
    viewPermission: 'banking.transfers.view',
    managePermission: 'banking.transfers.manage',
  },
  RECONCILIATION: {
    delegate: 'reconciliation',
    viewPermission: 'banking.reconciliations.view',
    managePermission: 'banking.reconciliations.manage',
  },
  INVENTORY_ADJUSTMENT: {
    delegate: 'inventoryAdjustment',
    viewPermission: 'inventory.adjustments.view',
    managePermission: 'inventory.adjustments.manage',
  },
  PROJECT: {
    delegate: 'project',
    viewPermission: 'projects.view',
    managePermission: 'projects.manage',
  },
  STOCK_MOVEMENT: {
    delegate: 'stockMovement',
    viewPermission: 'inventory.movements.view',
    managePermission: 'inventory.adjustments.manage',
  },
  TIME_ENTRY: {
    delegate: 'timeEntry',
    viewPermission: 'projects.time.view',
    managePermission: 'projects.time.manage',
  },
};

/**
 * Narrows a caller-supplied string to a known target type. Every collaboration entry point runs
 * through here, so an unrecognised type is refused before it can reach a query -- and downstream
 * code receives the enum value rather than the raw request string.
 */
/**
 * Resolves a target row by delegate name. The registry is the single place a target type is mapped
 * to a Prisma model, and the delegate name always comes from that table -- never from request data
 * -- so the index is safe even though its type cannot be expressed statically.
 */
async function findById(
  prisma: PrismaService,
  delegate: string,
  where: Record<string, string>,
): Promise<{ id: string } | null> {
  const model = (prisma as unknown as Record<string, ModelDelegate>)[delegate];
  if (!model) throw new NotFoundException('Collaboration target not found.');
  return model.findFirst({ where, select: { id: true } });
}

interface ModelDelegate {
  findFirst(args: {
    where: Record<string, string>;
    select: { id: true };
  }): Promise<{ id: string } | null>;
}

export function resolveTargetType(type: string): CollaborationTargetType {
  if (!Object.hasOwn(TARGETS, type)) throw new NotFoundException('Collaboration target not found.');
  return type as CollaborationTargetType;
}

export function targetDefinition(type: string): TargetDefinition {
  return TARGETS[resolveTargetType(type)];
}

export async function requireInternalTarget(
  prisma: PrismaService,
  context: OrganizationContext,
  type: string,
  id: string,
  mode: 'view' | 'manage',
) {
  const targetType = resolveTargetType(type);
  const definition = TARGETS[targetType];
  const permission = mode === 'view' ? definition.viewPermission : definition.managePermission;
  if (!context.permissions.has(permission as never))
    throw new NotFoundException('Collaboration target not found.');
  // The delegate is looked up by name from the registry, which is the one place a target type is
  // mapped to a model; that indirection is what the cast buys, and the key is never caller data.
  //
  // Only `id` is selected. Half these models have no `contactId` at all -- a Bill has a vendor, a
  // Journal has neither -- so asking for it made every purchasing, banking, inventory, project and
  // ledger target fail the query outright rather than answer. Whether a target may be shown to a
  // customer is the registry's `customerEligible` flag, not a column on the row.
  const target = await findById(prisma, definition.delegate, {
    id,
    organizationId: context.id,
  });
  if (!target) throw new NotFoundException('Collaboration target not found.');
  return { id: target.id, targetType, definition };
}

export async function requirePortalTarget(
  prisma: PrismaService,
  scope: { organizationId: string; contactId: string },
  type: string,
  id: string,
) {
  const targetType = resolveTargetType(type);
  const definition = TARGETS[targetType];
  if (!definition.customerEligible) throw new NotFoundException('Portal document not found.');
  const target = await findById(prisma, definition.delegate, {
    id,
    organizationId: scope.organizationId,
    contactId: scope.contactId,
  });
  if (!target) throw new NotFoundException('Portal document not found.');
  return targetType;
}
