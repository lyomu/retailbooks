import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma, type PurchaseOrderStatus } from '@prisma/client';
import { roundHalfUpDivide } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { PURCHASE_ORDER_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type {
  CreatePurchaseOrderDto,
  PurchaseOrderLineDto,
  RecordPurchaseOrderReceiptDto,
  UpdatePurchaseOrderDto,
} from './purchase-orders.dto.js';

const QUANTITY_SCALE = 10_000n;

type PurchaseOrderWithLines = Prisma.PurchaseOrderGetPayload<{
  include: typeof orderDetailInclude;
}>;

const orderDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  vendor: { select: { id: true, displayName: true, currency: true } },
} satisfies Prisma.PurchaseOrderInclude;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly inventory: InventoryService,
  ) {}

  async list(organizationId: string, status?: string) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: orderDetailInclude,
      take: 200,
    });
    return orders.map(summarizeOrder);
  }

  async detail(organizationId: string, orderId: string) {
    const order = await this.findOrThrow(organizationId, orderId);
    return summarizeOrder(order);
  }

  async createDraft(
    context: OrganizationContext,
    user: PublicUser,
    input: CreatePurchaseOrderDto,
    metadata: RequestMetadata,
  ) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: input.vendorId, organizationId: context.id },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');
    if (vendor.status !== 'ACTIVE') {
      throw new ConflictException('Cannot create an order for a deactivated vendor.');
    }
    const currency = input.currency ?? vendor.currency;
    const resolvedLines = await this.resolveLines(context.id, input.lines);
    const totalMinor = resolvedLines.reduce((sum, line) => sum + line.lineTotalMinor, 0n);

    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.create({
        data: {
          organizationId: context.id,
          vendorId: vendor.id,
          currency,
          expectedDeliveryDate: input.expectedDeliveryDate
            ? isoDate(input.expectedDeliveryDate)
            : null,
          deliveryNote: input.deliveryNote ?? null,
          subtotalMinor: totalMinor,
          totalMinor,
          createdByUserId: user.id,
          lines: {
            create: resolvedLines.map((line, index) => lineCreateData(line, index, context.id)),
          },
        },
        include: orderDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.order_created',
        entityType: 'purchase_order',
        entityId: order.id,
        action: AuditAction.CREATE,
        after: { vendorId: vendor.id, totalMinor: totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return order;
    });

    return summarizeOrder(created);
  }

  async updateDraft(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    input: UpdatePurchaseOrderDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, orderId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft orders can be edited.');
    }

    let vendor = existing.vendor;
    if (input.vendorId && input.vendorId !== existing.vendorId) {
      const nextVendor = await this.prisma.vendor.findFirst({
        where: { id: input.vendorId, organizationId: context.id },
      });
      if (!nextVendor) throw new NotFoundException('Vendor not found.');
      if (nextVendor.status !== 'ACTIVE') {
        throw new ConflictException('Cannot create an order for a deactivated vendor.');
      }
      vendor = {
        id: nextVendor.id,
        displayName: nextVendor.displayName,
        currency: nextVendor.currency,
      };
    }

    const currency = input.currency ?? vendor.currency;
    const resolvedLines = input.lines ? await this.resolveLines(context.id, input.lines) : null;
    const totalMinor = resolvedLines
      ? resolvedLines.reduce((sum, line) => sum + line.lineTotalMinor, 0n)
      : existing.totalMinor;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: orderId } });
      }
      const order = await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          vendorId: vendor.id,
          currency,
          ...(input.expectedDeliveryDate !== undefined
            ? { expectedDeliveryDate: isoDate(input.expectedDeliveryDate) }
            : {}),
          ...(input.deliveryNote !== undefined ? { deliveryNote: input.deliveryNote } : {}),
          subtotalMinor: totalMinor,
          totalMinor,
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
        include: orderDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.order_updated',
        entityType: 'purchase_order',
        entityId: orderId,
        action: AuditAction.UPDATE,
        before: { totalMinor: existing.totalMinor.toString() },
        after: { totalMinor: totalMinor.toString() },
        ipHash: metadata.ipHash,
      });

      return order;
    });

    return summarizeOrder(updated);
  }

  /** DRAFT -> APPROVED. No document number yet -- still an internal-only state. */
  approve(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, orderId, metadata, {
      from: ['DRAFT'],
      to: 'APPROVED',
      eventKey: 'purchases.order_approved',
      errorMessage: 'Only draft orders can be approved.',
    });
  }

  /** APPROVED -> ISSUED. Allocates the order's number here -- the point it's sent to the vendor,
   * mirroring Bills/Invoices' issue-time numbering rather than SalesOrder's approve-time numbering,
   * since Purchase Orders have this extra explicit "sent to vendor" step the roadmap calls for. */
  async issue(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, orderId);
    if (existing.status !== 'APPROVED') {
      throw new ConflictException('Only approved orders can be issued.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        PURCHASE_ORDER_DOCUMENT_TYPE,
        new Date(),
      );
      const order = await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: 'ISSUED',
          orderNumber: allocation.value,
          issueDate: isoDate(dateOnly(new Date())),
        },
        include: orderDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.order_issued',
        entityType: 'purchase_order',
        entityId: orderId,
        action: AuditAction.UPDATE,
        before: { status: 'APPROVED' },
        after: { status: 'ISSUED', orderNumber: allocation.value },
        ipHash: metadata.ipHash,
      });
      return order;
    });
    return summarizeOrder(updated);
  }

  async recordReceipt(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    input: RecordPurchaseOrderReceiptDto | 'PARTIALLY_RECEIVED' | 'RECEIVED',
    metadata: RequestMetadata,
  ) {
    if (typeof input === 'string') {
      throw new BadRequestException('Receipt status is derived from stock receipt movements.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      return this.inventory.recordPurchaseOrderReceipt(
        context,
        user,
        orderId,
        input,
        metadata,
        tx,
      );
    });
    return summarizeOrder(updated);
  }

  close(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, orderId, metadata, {
      from: ['ISSUED'],
      to: 'CLOSED',
      eventKey: 'purchases.order_closed',
      errorMessage: 'Only issued orders can be closed.',
    });
  }

  cancel(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, orderId, metadata, {
      from: ['DRAFT', 'APPROVED', 'ISSUED'],
      to: 'CANCELLED',
      eventKey: 'purchases.order_cancelled',
      errorMessage: 'Closed orders cannot be cancelled.',
    });
  }

  private async transition(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
    options: {
      from: readonly PurchaseOrderStatus[];
      to: PurchaseOrderStatus;
      eventKey: string;
      errorMessage: string;
    },
  ) {
    const existing = await this.findOrThrow(context.id, orderId);
    if (!options.from.includes(existing.status)) {
      throw new ConflictException(options.errorMessage);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: options.to },
        include: orderDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: options.eventKey,
        entityType: 'purchase_order',
        entityId: orderId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: options.to },
        ipHash: metadata.ipHash,
      });
      return order;
    });
    return summarizeOrder(updated);
  }

  private async findOrThrow(organizationId: string, orderId: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, organizationId },
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    return order;
  }

  private async resolveLines(organizationId: string, lines: readonly PurchaseOrderLineDto[]) {
    const itemIds = Array.from(
      new Set(lines.map((line) => line.itemId).filter((id): id is string => Boolean(id))),
    );
    const items =
      itemIds.length === 0
        ? []
        : await this.prisma.item.findMany({
            where: { id: { in: itemIds }, organizationId },
            include: { prices: true },
          });
    const itemsById = new Map(items.map((item) => [item.id, item]));

    const warehouseIds = Array.from(
      new Set(lines.map((line) => line.warehouseId).filter((id): id is string => Boolean(id))),
    );
    const warehouses =
      warehouseIds.length === 0
        ? []
        : await this.prisma.warehouse.findMany({
            where: { id: { in: warehouseIds }, organizationId },
          });
    const warehousesById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));

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
      if (item?.inventoryTracked && !line.warehouseId) {
        throw new BadRequestException(`${label}: tracked items need a warehouse.`);
      }
      const warehouse = line.warehouseId ? warehousesById.get(line.warehouseId) : undefined;
      if (line.warehouseId && !warehouse) {
        throw new BadRequestException(`${label}: warehouse not found.`);
      }
      if (warehouse?.status !== 'ACTIVE') {
        throw new BadRequestException(`${label}: warehouse is inactive.`);
      }

      if (!line.unitPriceMinor) {
        throw new BadRequestException(
          `${label}: a unit price is required (purchase prices have no per-item default).`,
        );
      }
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
        taxCodeId: line.taxCodeId ?? item?.defaultPurchaseTaxCodeId ?? item?.defaultTaxCodeId ?? null,
        warehouseId: line.warehouseId ?? null,
      };
    });
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

function lineCreateData(
  line: {
    itemId: string | null;
    descriptionSnapshot: string;
    quantity: string;
    unitPriceMinor: bigint;
    discountMinor: bigint;
    lineTotalMinor: bigint;
    taxCodeId: string | null;
    warehouseId: string | null;
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
    warehouseId: line.warehouseId,
  };
}

function summarizeOrder(order: PurchaseOrderWithLines) {
  return {
    id: order.id,
    vendorId: order.vendorId,
    vendorName: order.vendor.displayName,
    orderNumber: order.orderNumber,
    status: order.status,
    receiptStatus: order.receiptStatus,
    issueDate: order.issueDate ? dateOnly(order.issueDate) : null,
    expectedDeliveryDate: order.expectedDeliveryDate ? dateOnly(order.expectedDeliveryDate) : null,
    deliveryNote: order.deliveryNote,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor.toString(),
    totalMinor: order.totalMinor.toString(),
    billedMinor: order.billedMinor.toString(),
    lines: order.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      descriptionSnapshot: line.descriptionSnapshot,
      quantity: line.quantity.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
      taxCodeId: line.taxCodeId,
      warehouseId: line.warehouseId,
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
