import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';

type TargetDefinition = {
  delegate: string;
  viewPermission: string;
  managePermission: string;
  customerEligible?: boolean;
};

/** One registry is the only way comments/files/activity learn what a target is. */
const TARGETS: Record<string, TargetDefinition> = {
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

export function targetDefinition(type: string): TargetDefinition {
  const target = TARGETS[type];
  if (!target) throw new NotFoundException('Collaboration target not found.');
  return target;
}

export async function requireInternalTarget(
  prisma: PrismaService,
  context: OrganizationContext,
  type: string,
  id: string,
  mode: 'view' | 'manage',
) {
  const definition = targetDefinition(type);
  const permission = mode === 'view' ? definition.viewPermission : definition.managePermission;
  if (!context.permissions.has(permission as never))
    throw new NotFoundException('Collaboration target not found.');
  const target = await (prisma as any)[definition.delegate].findFirst({
    where: { id, organizationId: context.id },
    select: { id: true, contactId: true },
  });
  if (!target) throw new NotFoundException('Collaboration target not found.');
  return { ...target, definition };
}

export async function requirePortalTarget(
  prisma: PrismaService,
  scope: { organizationId: string; contactId: string },
  type: string,
  id: string,
) {
  const definition = targetDefinition(type);
  if (!definition.customerEligible) throw new NotFoundException('Portal document not found.');
  const target = await (prisma as any)[definition.delegate].findFirst({
    where: { id, organizationId: scope.organizationId, contactId: scope.contactId },
    select: { id: true },
  });
  if (!target) throw new NotFoundException('Portal document not found.');
  return definition;
}
