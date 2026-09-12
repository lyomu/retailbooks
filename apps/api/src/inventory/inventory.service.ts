import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  type InventoryAdjustmentStatus,
  Prisma,
  type StockMovementSourceType,
} from '@prisma/client';
import { roundHalfUpDivide } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import { assertNoPendingApproval } from '../automation/approval-targets.js';
import { DomainEventsService } from '../automation/domain-events.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type { RecordPurchaseOrderReceiptDto } from '../purchases/purchase-orders.dto.js';
import type {
  CreateInventoryAdjustmentDto,
  CreateInventoryTransferDto,
  CreateWarehouseDto,
  UpdateInventoryAdjustmentDto,
  UpdateWarehouseDto,
} from './inventory.dto.js';

const QUANTITY_SCALE = 10_000n;

type Tx = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly events: DomainEventsService,
  ) {}

  async listWarehouses(organizationId: string) {
    return this.prisma.warehouse.findMany({
      where: { organizationId },
      orderBy: [{ code: 'asc' }],
    });
  }

  async createWarehouse(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateWarehouseDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.warehouse.findUnique({
      where: { organizationId_code: { organizationId: context.id, code: input.code } },
    });
    if (existing) throw new ConflictException('A warehouse with this code already exists.');

    return this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.create({
        data: {
          organizationId: context.id,
          code: input.code,
          name: input.name,
          address: input.address ?? null,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'inventory.warehouse_created',
        entityType: 'warehouse',
        entityId: warehouse.id,
        action: AuditAction.CREATE,
        after: { code: warehouse.code, name: warehouse.name },
        ipHash: metadata.ipHash,
      });
      return summarizeWarehouse(warehouse);
    });
  }

  async updateWarehouse(
    context: OrganizationContext,
    user: PublicUser,
    warehouseId: string,
    input: UpdateWarehouseDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Warehouse not found.');
    if (input.code && input.code !== existing.code) {
      const clash = await this.prisma.warehouse.findUnique({
        where: { organizationId_code: { organizationId: context.id, code: input.code } },
      });
      if (clash) throw new ConflictException('A warehouse with this code already exists.');
    }

    return this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.update({
        where: { id: warehouseId },
        data: {
          code: input.code ?? existing.code,
          name: input.name ?? existing.name,
          address: input.address !== undefined ? input.address : existing.address,
          status: input.status ?? existing.status,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'inventory.warehouse_updated',
        entityType: 'warehouse',
        entityId: warehouseId,
        action: AuditAction.UPDATE,
        before: { code: existing.code, name: existing.name, status: existing.status },
        after: { code: warehouse.code, name: warehouse.name, status: warehouse.status },
        ipHash: metadata.ipHash,
      });
      return summarizeWarehouse(warehouse);
    });
  }

  async listMovements(organizationId: string, itemId?: string, warehouseId?: string) {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        organizationId,
        ...(itemId ? { itemId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        item: { select: { name: true, sku: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map(summarizeMovement);
  }

  async listAdjustments(organizationId: string, status?: string) {
    const rows = await this.prisma.inventoryAdjustment.findMany({
      where: { organizationId, ...(status ? { status: status as InventoryAdjustmentStatus } : {}) },
      include: {
        item: { select: { name: true, sku: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: [{ adjustmentDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map(summarizeAdjustment);
  }

  async createAdjustment(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateInventoryAdjustmentDto,
    metadata: RequestMetadata,
  ) {
    await this.assertTrackedItem(context.id, input.itemId);
    await this.ensureWarehouse(context.id, input.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.inventoryAdjustment.create({
        data: {
          organizationId: context.id,
          itemId: input.itemId,
          warehouseId: input.warehouseId,
          adjustmentDate: isoDate(input.adjustmentDate),
          quantityDelta: input.quantityDelta,
          valueDeltaMinor: BigInt(input.valueDeltaMinor ?? '0'),
          reason: input.reason,
          accountId: input.accountId ?? null,
          createdByUserId: user.id,
        },
        include: adjustmentInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'inventory.adjustment_created',
        entityType: 'inventory_adjustment',
        entityId: adjustment.id,
        action: AuditAction.CREATE,
        after: { itemId: input.itemId, quantityDelta: input.quantityDelta },
        ipHash: metadata.ipHash,
      });
      return summarizeAdjustment(adjustment);
    });
  }

  async updateAdjustment(
    context: OrganizationContext,
    user: PublicUser,
    adjustmentId: string,
    input: UpdateInventoryAdjustmentDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findAdjustment(context.id, adjustmentId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft adjustments can be edited.');
    }
    const itemId = input.itemId ?? existing.itemId;
    const warehouseId = input.warehouseId ?? existing.warehouseId;
    await this.assertTrackedItem(context.id, itemId);
    await this.ensureWarehouse(context.id, warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.inventoryAdjustment.update({
        where: { id: adjustmentId },
        data: {
          itemId,
          warehouseId,
          adjustmentDate: input.adjustmentDate
            ? isoDate(input.adjustmentDate)
            : existing.adjustmentDate,
          quantityDelta: input.quantityDelta ?? existing.quantityDelta,
          valueDeltaMinor:
            input.valueDeltaMinor !== undefined
              ? BigInt(input.valueDeltaMinor)
              : existing.valueDeltaMinor,
          reason: input.reason ?? existing.reason,
          accountId: input.accountId !== undefined ? input.accountId : existing.accountId,
        },
        include: adjustmentInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'inventory.adjustment_updated',
        entityType: 'inventory_adjustment',
        entityId: adjustmentId,
        action: AuditAction.UPDATE,
        after: { itemId, warehouseId },
        ipHash: metadata.ipHash,
      });
      return summarizeAdjustment(adjustment);
    });
  }

  submitAdjustment(
    context: OrganizationContext,
    user: PublicUser,
    adjustmentId: string,
    metadata: RequestMetadata,
  ) {
    return this.transitionAdjustment(context, user, adjustmentId, metadata, {
      from: ['DRAFT'],
      to: 'PENDING_APPROVAL',
      eventKey: 'inventory.adjustment_submitted',
      message: 'Only draft adjustments can be submitted.',
    });
  }

  approveAdjustment(
    context: OrganizationContext,
    user: PublicUser,
    adjustmentId: string,
    metadata: RequestMetadata,
  ) {
    return this.transitionAdjustment(context, user, adjustmentId, metadata, {
      from: ['PENDING_APPROVAL'],
      to: 'APPROVED',
      eventKey: 'inventory.adjustment_approved',
      message: 'Only pending adjustments can be approved.',
      data: { approvedByUserId: user.id },
    });
  }

  cancelAdjustment(
    context: OrganizationContext,
    user: PublicUser,
    adjustmentId: string,
    metadata: RequestMetadata,
  ) {
    return this.transitionAdjustment(context, user, adjustmentId, metadata, {
      from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'],
      to: 'CANCELLED',
      eventKey: 'inventory.adjustment_cancelled',
      message: 'Posted or voided adjustments cannot be cancelled.',
    });
  }

  async postAdjustment(
    context: OrganizationContext,
    user: PublicUser,
    adjustmentId: string,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const key = idempotencyKey ?? adjustmentId;
    const posted = await this.prisma.$transaction(async (tx) => {
      await this.lockPostIdempotency(tx, context.id, key);
      const existingResult = await this.findPostIdempotentResult(context.id, key, tx);
      if (existingResult) {
        return tx.inventoryAdjustment.findFirstOrThrow({
          where: {
            id: adjustmentId,
            organizationId: context.id,
            journalId: existingResult.resourceId,
          },
          include: adjustmentInclude,
        });
      }

      const adjustment = await tx.inventoryAdjustment.findFirst({
        where: { id: adjustmentId, organizationId: context.id },
        include: adjustmentInclude,
      });
      if (!adjustment) throw new NotFoundException('Inventory adjustment not found.');
      await assertNoPendingApproval(tx, context.id, 'INVENTORY_ADJUSTMENT', adjustmentId);
      if (adjustment.status !== 'DRAFT' && adjustment.status !== 'APPROVED') {
        throw new ConflictException('Only draft or approved adjustments can be posted.');
      }
      if (!adjustment.item.inventoryTracked) {
        throw new ConflictException('Only tracked items can be adjusted.');
      }

      const quantityScaled = toScaled(adjustment.quantityDelta.toString());
      const inventoryAccount = await this.ledger.accountBySystemKey(
        context.id,
        'inventory_asset',
        tx,
      );
      const offsetAccount = adjustment.accountId
        ? await tx.ledgerAccount.findFirstOrThrow({
            where: { id: adjustment.accountId, organizationId: context.id },
          })
        : await this.ledger.accountBySystemKey(context.id, 'general_expense', tx);

      let valueMinor = adjustment.valueDeltaMinor;
      if (quantityScaled > 0n) {
        if (valueMinor <= 0n) {
          throw new BadRequestException('Positive stock adjustments need a positive value delta.');
        }
        await this.createInboundLayer(tx, context, user, {
          itemId: adjustment.itemId,
          warehouseId: adjustment.warehouseId,
          movementDate: adjustment.adjustmentDate,
          quantityScaled,
          totalCostMinor: valueMinor,
          sourceType: 'ADJUSTMENT',
          sourceId: adjustment.id,
          sourceLineId: null,
        });
      } else if (quantityScaled < 0n) {
        valueMinor = await this.consumeStock(tx, context, user, {
          itemId: adjustment.itemId,
          warehouseId: adjustment.warehouseId,
          movementDate: adjustment.adjustmentDate,
          quantityScaled: -quantityScaled,
          sourceType: 'ADJUSTMENT',
          sourceId: adjustment.id,
          sourceLineId: null,
        });
      } else if (valueMinor === 0n) {
        throw new BadRequestException('Adjustment quantity or value must change.');
      }

      const absoluteValue = valueMinor < 0n ? -valueMinor : valueMinor;
      const debitInventory = quantityScaled > 0n || (quantityScaled === 0n && valueMinor > 0n);
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      const journal = await this.ledger.postJournalFromLines(
        context,
        user,
        'INVENTORY_ADJUSTMENT_POST',
        {
          journalDate: adjustment.adjustmentDate,
          currency: organization.baseCurrency,
          description: `Inventory adjustment: ${adjustment.reason}`,
          sourceType: 'INVENTORY_ADJUSTMENT',
          sourceId: adjustment.id,
          lines: [
            {
              accountId: debitInventory ? inventoryAccount.id : offsetAccount.id,
              debitMinor: absoluteValue,
              creditMinor: 0n,
            },
            {
              accountId: debitInventory ? offsetAccount.id : inventoryAccount.id,
              debitMinor: 0n,
              creditMinor: absoluteValue,
            },
          ],
        },
        metadata,
        key,
        tx,
      );

      const updated = await tx.inventoryAdjustment.update({
        where: { id: adjustment.id },
        data: { status: 'POSTED', journalId: journal.id, postedByUserId: user.id },
        include: adjustmentInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'inventory.adjustment_posted',
        entityType: 'inventory_adjustment',
        entityId: adjustment.id,
        action: AuditAction.UPDATE,
        after: { journalId: journal.id, valueMinor: absoluteValue.toString() },
        ipHash: metadata.ipHash,
      });
      return updated;
    });
    return summarizeAdjustment(posted);
  }

  async transferStock(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateInventoryTransferDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const item = await this.assertTrackedItem(context.id, input.itemId);
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must differ.');
    }
    await this.ensureWarehouse(context.id, input.fromWarehouseId);
    await this.ensureWarehouse(context.id, input.toWarehouseId);
    if (idempotencyKey) {
      const existing = await this.findTransferIdempotentResult(context.id, idempotencyKey);
      if (existing) return { id: existing.resourceId, itemId: item.id, quantity: input.quantity };
    }
    const transferId = randomUUID();

    const resolvedTransferId = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        await this.lockTransferIdempotency(tx, context.id, idempotencyKey);
        const existing = await this.findTransferIdempotentResult(context.id, idempotencyKey, tx);
        if (existing) return existing.resourceId;
      }
      const totalCostMinor = await this.consumeStock(tx, context, user, {
        itemId: item.id,
        warehouseId: input.fromWarehouseId,
        movementDate: isoDate(input.transferDate),
        quantityScaled: toScaled(input.quantity),
        sourceType: 'TRANSFER',
        sourceId: transferId,
        sourceLineId: null,
      });
      await this.createInboundLayer(tx, context, user, {
        itemId: item.id,
        warehouseId: input.toWarehouseId,
        movementDate: isoDate(input.transferDate),
        quantityScaled: toScaled(input.quantity),
        totalCostMinor,
        sourceType: 'TRANSFER',
        sourceId: transferId,
        sourceLineId: null,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'inventory.transfer_created',
        entityType: 'inventory_transfer',
        entityId: transferId,
        action: AuditAction.CREATE,
        after: { itemId: item.id, quantity: input.quantity },
        ipHash: metadata.ipHash,
      });
      if (idempotencyKey) {
        await this.recordTransferIdempotency(tx, context.id, idempotencyKey, transferId);
      }
      return transferId;
    });

    return { id: resolvedTransferId, itemId: item.id, quantity: input.quantity };
  }

  async reorderAdvice(organizationId: string) {
    const items = await this.prisma.item.findMany({
      where: {
        organizationId,
        inventoryTracked: true,
        status: 'ACTIVE',
        reorderThreshold: { not: null },
      },
      include: { preferredVendor: { select: { id: true, displayName: true } } },
      orderBy: [{ name: 'asc' }],
    });
    const rows = [];
    for (const item of items) {
      const onHandScaled = await this.stockOnHandScaled(organizationId, item.id);
      const thresholdScaled = toScaled(item.reorderThreshold?.toString() ?? '0');
      if (onHandScaled <= thresholdScaled) {
        rows.push({
          id: item.id,
          itemId: item.id,
          itemName: item.name,
          sku: item.sku,
          onHand: scaledToDecimal(onHandScaled),
          reorderThreshold: item.reorderThreshold?.toString() ?? null,
          suggestedQuantity: item.reorderQuantity?.toString() ?? null,
          preferredVendorId: item.preferredVendorId,
          preferredVendorName: item.preferredVendor?.displayName ?? null,
        });
      }
    }
    return rows;
  }

  async valuationReport(organizationId: string) {
    const layers = await this.prisma.valuationLayer.findMany({
      where: { organizationId },
      include: {
        item: { select: { name: true, sku: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: [{ item: { name: 'asc' } }, { warehouse: { code: 'asc' } }],
    });
    const grouped = new Map<
      string,
      {
        id: string;
        itemId: string;
        itemName: string;
        sku: string | null;
        warehouseId: string;
        warehouseName: string;
        quantityOnHandScaled: bigint;
        valueMinor: bigint;
      }
    >();
    for (const layer of layers) {
      const key = `${layer.itemId}:${layer.warehouseId}`;
      const current = grouped.get(key) ?? {
        id: key,
        itemId: layer.itemId,
        itemName: layer.item.name,
        sku: layer.item.sku,
        warehouseId: layer.warehouseId,
        warehouseName: `${layer.warehouse.code} ${layer.warehouse.name}`,
        quantityOnHandScaled: 0n,
        valueMinor: 0n,
      };
      current.quantityOnHandScaled += toScaled(layer.quantityRemaining.toString());
      current.valueMinor += layer.costRemainingMinor;
      grouped.set(key, current);
    }
    const rows = [...grouped.values()].map((row) => ({
      ...row,
      quantityOnHand: scaledToDecimal(row.quantityOnHandScaled),
      valueMinor: row.valueMinor.toString(),
      quantityOnHandScaled: undefined,
    }));
    const totalValueMinor = rows.reduce((sum, row) => sum + BigInt(row.valueMinor), 0n);
    return { rows, totalValueMinor: totalValueMinor.toString() };
  }

  async recordPurchaseOrderReceipt(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    input: RecordPurchaseOrderReceiptDto,
    metadata: RequestMetadata,
    tx: Tx,
  ) {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: orderId, organizationId: context.id },
      include: { lines: { include: { item: true } }, vendor: { select: { displayName: true } } },
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    if (order.status !== 'ISSUED') {
      throw new ConflictException('Only issued orders can have receipts recorded.');
    }

    const linesById = new Map(order.lines.map((line) => [line.id, line]));
    for (const receiptLine of input.lines) {
      const line = linesById.get(receiptLine.purchaseOrderLineId);
      if (!line) throw new BadRequestException('Receipt line does not belong to this order.');
      if (!line.item?.inventoryTracked) continue;
      const warehouseId = receiptLine.warehouseId ?? line.warehouseId;
      if (!warehouseId) throw new BadRequestException('Tracked purchase lines need a warehouse.');
      await this.ensureWarehouse(context.id, warehouseId, tx);
      const quantityScaled = toScaled(receiptLine.quantity);
      if (quantityScaled <= 0n) throw new BadRequestException('Receipt quantity must be positive.');
      const orderedScaled = toScaled(line.quantity.toString());
      const receivedScaled = await this.receivedForLineScaled(context.id, line.id, tx);
      if (receivedScaled + quantityScaled > orderedScaled) {
        throw new BadRequestException('Receipt quantity exceeds the unreceived quantity.');
      }
      const unitCostMinor = roundHalfUpDivide(line.lineTotalMinor * QUANTITY_SCALE, orderedScaled);
      const totalCostMinor = roundHalfUpDivide(quantityScaled * unitCostMinor, QUANTITY_SCALE);
      await this.createInboundLayer(tx, context, user, {
        itemId: line.item.id,
        warehouseId,
        movementDate: isoDate(dateOnly(new Date())),
        quantityScaled,
        totalCostMinor,
        sourceType: 'PURCHASE_RECEIPT',
        sourceId: order.id,
        sourceLineId: line.id,
      });
    }

    const receiptStatus = await this.deriveReceiptStatus(context.id, order.id, tx);
    const updated = await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { receiptStatus },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        vendor: { select: { id: true, displayName: true, currency: true } },
      },
    });
    await writeAuditEvent(tx, {
      organizationId: context.id,
      actorUserId: user.id,
      eventKey: 'purchases.order_receipt_recorded',
      entityType: 'purchase_order',
      entityId: order.id,
      action: AuditAction.UPDATE,
      before: { receiptStatus: order.receiptStatus },
      after: { receiptStatus },
      ipHash: metadata.ipHash,
    });
    return updated;
  }

  async postInvoiceCogs(
    context: OrganizationContext,
    user: PublicUser,
    invoiceId: string,
    metadata: RequestMetadata,
    tx: Tx,
  ) {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId: context.id },
      include: { lines: { include: { item: true }, orderBy: { lineNumber: 'asc' } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');

    let cogsMinor = 0n;
    for (const line of invoice.lines) {
      if (!line.item?.inventoryTracked) continue;
      if (!line.warehouseId) {
        throw new BadRequestException(
          `Line ${line.lineNumber}: tracked inventory needs a warehouse.`,
        );
      }
      cogsMinor += await this.consumeStock(tx, context, user, {
        itemId: line.item.id,
        warehouseId: line.warehouseId,
        movementDate: invoice.issueDate ?? isoDate(dateOnly(new Date())),
        quantityScaled: toScaled(line.quantity.toString()),
        sourceType: 'SALES_ISSUE',
        sourceId: invoice.id,
        sourceLineId: line.id,
      });
    }
    if (cogsMinor === 0n) return null;

    const cogsAccount = await this.ledger.accountBySystemKey(context.id, 'cogs', tx);
    const inventoryAccount = await this.ledger.accountBySystemKey(
      context.id,
      'inventory_asset',
      tx,
    );
    return this.ledger.postJournalFromLines(
      context,
      user,
      'INVENTORY_COGS_POST',
      {
        journalDate: invoice.issueDate ?? isoDate(dateOnly(new Date())),
        currency: invoice.currency,
        description: `Inventory COGS for ${invoice.invoiceNumber ?? invoice.id}`,
        sourceType: 'INVENTORY_COGS',
        sourceId: invoice.id,
        lines: [
          { accountId: cogsAccount.id, debitMinor: cogsMinor, creditMinor: 0n },
          { accountId: inventoryAccount.id, debitMinor: 0n, creditMinor: cogsMinor },
        ],
      },
      metadata,
      invoice.id,
      tx,
    );
  }

  private async createInboundLayer(
    tx: Tx,
    context: OrganizationContext,
    user: PublicUser,
    input: {
      itemId: string;
      warehouseId: string;
      movementDate: Date;
      quantityScaled: bigint;
      totalCostMinor: bigint;
      sourceType: StockMovementSourceType;
      sourceId: string;
      sourceLineId: string | null;
    },
  ) {
    const unitCostMinor = roundHalfUpDivide(
      input.totalCostMinor * QUANTITY_SCALE,
      input.quantityScaled,
    );
    const layer = await tx.valuationLayer.create({
      data: {
        organizationId: context.id,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineId: input.sourceLineId,
        layerDate: input.movementDate,
        quantityIn: scaledToDecimal(input.quantityScaled),
        quantityRemaining: scaledToDecimal(input.quantityScaled),
        unitCostMinor,
        costRemainingMinor: input.totalCostMinor,
      },
    });
    const movement = await tx.stockMovement.create({
      data: {
        organizationId: context.id,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        movementDate: input.movementDate,
        direction: 'IN',
        quantity: scaledToDecimal(input.quantityScaled),
        unitCostMinor,
        totalCostMinor: input.totalCostMinor,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineId: input.sourceLineId,
        valuationLayerId: layer.id,
        createdByUserId: user.id,
      },
    });
    await this.events.emit(tx, {
      organizationId: context.id,
      aggregateType: 'stock_movement',
      aggregateId: movement.id,
      eventName: 'stock.moved',
      payload: {
        movementId: movement.id,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        direction: 'IN',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    });
    return layer;
  }

  private async consumeStock(
    tx: Tx,
    context: OrganizationContext,
    user: PublicUser,
    input: {
      itemId: string;
      warehouseId: string;
      movementDate: Date;
      quantityScaled: bigint;
      sourceType: StockMovementSourceType;
      sourceId: string;
      sourceLineId: string | null;
    },
  ) {
    const method = await this.inventoryValuationMethod(context.id, tx);
    const layers = await tx.valuationLayer.findMany({
      where: {
        organizationId: context.id,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        quantityRemaining: { gt: new Prisma.Decimal(0) },
      },
      orderBy: [{ layerDate: 'asc' }, { createdAt: 'asc' }],
    });
    const availableScaled = layers.reduce(
      (sum, layer) => sum + toScaled(layer.quantityRemaining.toString()),
      0n,
    );
    if (availableScaled < input.quantityScaled) {
      throw new ConflictException('Insufficient stock on hand for this movement.');
    }

    const totalAvailableCost = layers.reduce((sum, layer) => sum + layer.costRemainingMinor, 0n);
    if (method === 'WEIGHTED_AVERAGE') {
      return this.consumeWeightedAverageStock(tx, context, user, input, layers, {
        availableScaled,
        totalAvailableCost,
      });
    }

    let remainingScaled = input.quantityScaled;
    let totalCostMinor = 0n;

    for (const layer of layers) {
      if (remainingScaled === 0n) break;
      const layerRemainingScaled = toScaled(layer.quantityRemaining.toString());
      const consumeScaled =
        layerRemainingScaled < remainingScaled ? layerRemainingScaled : remainingScaled;
      const layerCost =
        consumeScaled === layerRemainingScaled
          ? layer.costRemainingMinor
          : roundHalfUpDivide(layer.costRemainingMinor * consumeScaled, layerRemainingScaled);
      const nextRemainingScaled = layerRemainingScaled - consumeScaled;
      await tx.valuationLayer.update({
        where: { id: layer.id },
        data: {
          quantityRemaining: scaledToDecimal(nextRemainingScaled),
          costRemainingMinor: layer.costRemainingMinor - layerCost,
        },
      });
      const movement = await tx.stockMovement.create({
        data: {
          organizationId: context.id,
          itemId: input.itemId,
          warehouseId: input.warehouseId,
          movementDate: input.movementDate,
          direction: 'OUT',
          quantity: scaledToDecimal(consumeScaled),
          unitCostMinor: roundHalfUpDivide(layerCost * QUANTITY_SCALE, consumeScaled),
          totalCostMinor: layerCost,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceLineId: input.sourceLineId,
          valuationLayerId: layer.id,
          createdByUserId: user.id,
        },
      });
      await this.events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'stock_movement',
        aggregateId: movement.id,
        eventName: 'stock.moved',
        payload: {
          movementId: movement.id,
          itemId: input.itemId,
          warehouseId: input.warehouseId,
          direction: 'OUT',
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      });
      remainingScaled -= consumeScaled;
      totalCostMinor += layerCost;
    }
    return totalCostMinor;
  }

  private async consumeWeightedAverageStock(
    tx: Tx,
    context: OrganizationContext,
    user: PublicUser,
    input: {
      itemId: string;
      warehouseId: string;
      movementDate: Date;
      quantityScaled: bigint;
      sourceType: StockMovementSourceType;
      sourceId: string;
      sourceLineId: string | null;
    },
    layers: {
      id: string;
      quantityRemaining: Prisma.Decimal;
      costRemainingMinor: bigint;
    }[],
    available: {
      availableScaled: bigint;
      totalAvailableCost: bigint;
    },
  ) {
    const weightedUnit = roundHalfUpDivide(
      available.totalAvailableCost * QUANTITY_SCALE,
      available.availableScaled,
    );
    const totalCostMinor = roundHalfUpDivide(
      input.quantityScaled * available.totalAvailableCost,
      available.availableScaled,
    );
    let remainingScaled = input.quantityScaled;
    let remainingCostMinor = totalCostMinor;

    for (const [index, layer] of layers.entries()) {
      if (remainingScaled === 0n) break;
      const layerRemainingScaled = toScaled(layer.quantityRemaining.toString());
      const isLastLayer = index === layers.length - 1;
      const targetScaled = isLastLayer
        ? remainingScaled
        : roundHalfUpDivide(layerRemainingScaled * input.quantityScaled, available.availableScaled);
      const consumeScaled =
        targetScaled > remainingScaled
          ? remainingScaled
          : targetScaled > layerRemainingScaled
            ? layerRemainingScaled
            : targetScaled;
      if (consumeScaled === 0n) continue;
      const layerCost = isLastLayer
        ? remainingCostMinor
        : roundHalfUpDivide(layer.costRemainingMinor * consumeScaled, layerRemainingScaled);
      const nextRemainingScaled = layerRemainingScaled - consumeScaled;
      await tx.valuationLayer.update({
        where: { id: layer.id },
        data: {
          quantityRemaining: scaledToDecimal(nextRemainingScaled),
          costRemainingMinor: layer.costRemainingMinor - layerCost,
        },
      });
      remainingScaled -= consumeScaled;
      remainingCostMinor -= layerCost;
    }

    const movement = await tx.stockMovement.create({
      data: {
        organizationId: context.id,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        movementDate: input.movementDate,
        direction: 'OUT',
        quantity: scaledToDecimal(input.quantityScaled),
        unitCostMinor: weightedUnit,
        totalCostMinor,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineId: input.sourceLineId,
        valuationLayerId: null,
        createdByUserId: user.id,
      },
    });
    await this.events.emit(tx, {
      organizationId: context.id,
      aggregateType: 'stock_movement',
      aggregateId: movement.id,
      eventName: 'stock.moved',
      payload: {
        movementId: movement.id,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        direction: 'OUT',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    });
    return totalCostMinor;
  }

  private async transitionAdjustment(
    context: OrganizationContext,
    user: PublicUser,
    adjustmentId: string,
    metadata: RequestMetadata,
    options: {
      from: readonly InventoryAdjustmentStatus[];
      to: InventoryAdjustmentStatus;
      eventKey: string;
      message: string;
      data?: Prisma.InventoryAdjustmentUncheckedUpdateInput;
    },
  ) {
    const existing = await this.findAdjustment(context.id, adjustmentId);
    if (!options.from.includes(existing.status)) throw new ConflictException(options.message);
    const updated = await this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.inventoryAdjustment.update({
        where: { id: adjustmentId },
        data: { status: options.to, ...(options.data ?? {}) },
        include: adjustmentInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: options.eventKey,
        entityType: 'inventory_adjustment',
        entityId: adjustmentId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: options.to },
        ipHash: metadata.ipHash,
      });
      return adjustment;
    });
    return summarizeAdjustment(updated);
  }

  private async assertTrackedItem(organizationId: string, itemId: string, tx?: Tx) {
    const client = tx ?? this.prisma;
    const item = await client.item.findFirst({ where: { id: itemId, organizationId } });
    if (!item) throw new NotFoundException('Item not found.');
    if (!item.inventoryTracked || item.itemType !== 'GOODS') {
      throw new ConflictException('Only tracked goods items can move through inventory.');
    }
    return item;
  }

  private async ensureWarehouse(organizationId: string, warehouseId: string, tx?: Tx) {
    const client = tx ?? this.prisma;
    const warehouse = await client.warehouse.findFirst({
      where: { id: warehouseId, organizationId },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found.');
    if (warehouse.status !== 'ACTIVE') throw new ConflictException('Warehouse is inactive.');
    return warehouse;
  }

  private async findAdjustment(organizationId: string, adjustmentId: string) {
    const adjustment = await this.prisma.inventoryAdjustment.findFirst({
      where: { id: adjustmentId, organizationId },
      include: adjustmentInclude,
    });
    if (!adjustment) throw new NotFoundException('Inventory adjustment not found.');
    return adjustment;
  }

  private async inventoryValuationMethod(organizationId: string, tx: Tx) {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { preferences: { select: { inventoryValuationMethod: true } } },
    });
    return organization?.preferences?.inventoryValuationMethod ?? 'FIFO';
  }

  private async stockOnHandScaled(organizationId: string, itemId: string) {
    const movements = await this.prisma.stockMovement.findMany({
      where: { organizationId, itemId },
      select: { direction: true, quantity: true },
    });
    return movements.reduce(
      (sum, movement) =>
        sum +
        (movement.direction === 'IN'
          ? toScaled(movement.quantity.toString())
          : -toScaled(movement.quantity.toString())),
      0n,
    );
  }

  private async receivedForLineScaled(organizationId: string, sourceLineId: string, tx: Tx) {
    const movements = await tx.stockMovement.findMany({
      where: { organizationId, sourceType: 'PURCHASE_RECEIPT', sourceLineId },
      select: { quantity: true },
    });
    return movements.reduce((sum, movement) => sum + toScaled(movement.quantity.toString()), 0n);
  }

  private async deriveReceiptStatus(organizationId: string, orderId: string, tx: Tx) {
    const lines = await tx.purchaseOrderLine.findMany({
      where: { organizationId, purchaseOrderId: orderId, item: { inventoryTracked: true } },
      select: { id: true, quantity: true },
    });
    if (lines.length === 0) return 'RECEIVED' as const;
    let ordered = 0n;
    let received = 0n;
    for (const line of lines) {
      ordered += toScaled(line.quantity.toString());
      received += await this.receivedForLineScaled(organizationId, line.id, tx);
    }
    if (received === 0n) return 'NOT_RECEIVED' as const;
    return received >= ordered ? ('RECEIVED' as const) : ('PARTIALLY_RECEIVED' as const);
  }

  private async lockPostIdempotency(tx: Tx, organizationId: string, key: string): Promise<void> {
    const lockKey = `${organizationId}:INVENTORY_ADJUSTMENT_POST:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private findPostIdempotentResult(
    organizationId: string,
    key: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: {
          organizationId,
          operation: 'INVENTORY_ADJUSTMENT_POST',
          key,
        },
      },
    });
  }

  private async lockTransferIdempotency(
    client: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    key: string,
  ): Promise<void> {
    const lockKey = `${organizationId}:INVENTORY_TRANSFER:${key}`;
    await client.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private findTransferIdempotentResult(
    organizationId: string,
    key: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return client.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: {
          organizationId,
          operation: 'INVENTORY_TRANSFER',
          key,
        },
      },
    });
  }

  private recordTransferIdempotency(
    tx: Tx,
    organizationId: string,
    key: string,
    transferId: string,
  ) {
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation: 'INVENTORY_TRANSFER',
        key,
        resourceType: 'INVENTORY_TRANSFER',
        resourceId: transferId,
      },
    });
  }
}

const adjustmentInclude = {
  item: { select: { name: true, sku: true, inventoryTracked: true } },
  warehouse: { select: { code: true, name: true } },
} satisfies Prisma.InventoryAdjustmentInclude;

function summarizeWarehouse(warehouse: {
  id: string;
  code: string;
  name: string;
  address: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    address: warehouse.address,
    status: warehouse.status,
    createdAt: warehouse.createdAt.toISOString(),
    updatedAt: warehouse.updatedAt.toISOString(),
  };
}

function summarizeMovement(movement: {
  id: string;
  itemId: string;
  warehouseId: string;
  movementDate: Date;
  direction: string;
  quantity: Prisma.Decimal;
  unitCostMinor: bigint;
  totalCostMinor: bigint;
  sourceType: string;
  sourceId: string;
  sourceLineId: string | null;
  createdAt: Date;
  item: { name: string; sku: string | null };
  warehouse: { code: string; name: string };
}) {
  return {
    id: movement.id,
    itemId: movement.itemId,
    itemName: movement.item.name,
    sku: movement.item.sku,
    warehouseId: movement.warehouseId,
    warehouseName: `${movement.warehouse.code} ${movement.warehouse.name}`,
    movementDate: dateOnly(movement.movementDate),
    direction: movement.direction,
    quantity: movement.quantity.toString(),
    unitCostMinor: movement.unitCostMinor.toString(),
    totalCostMinor: movement.totalCostMinor.toString(),
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    sourceLineId: movement.sourceLineId,
    createdAt: movement.createdAt.toISOString(),
  };
}

function summarizeAdjustment(adjustment: {
  id: string;
  itemId: string;
  warehouseId: string;
  adjustmentDate: Date;
  quantityDelta: Prisma.Decimal;
  valueDeltaMinor: bigint;
  reason: string;
  accountId: string | null;
  status: string;
  journalId: string | null;
  createdAt: Date;
  updatedAt: Date;
  item: { name: string; sku: string | null };
  warehouse: { code: string; name: string };
}) {
  return {
    id: adjustment.id,
    itemId: adjustment.itemId,
    itemName: adjustment.item.name,
    sku: adjustment.item.sku,
    warehouseId: adjustment.warehouseId,
    warehouseName: `${adjustment.warehouse.code} ${adjustment.warehouse.name}`,
    adjustmentDate: dateOnly(adjustment.adjustmentDate),
    quantityDelta: adjustment.quantityDelta.toString(),
    valueDeltaMinor: adjustment.valueDeltaMinor.toString(),
    reason: adjustment.reason,
    accountId: adjustment.accountId,
    status: adjustment.status,
    journalId: adjustment.journalId,
    createdAt: adjustment.createdAt.toISOString(),
    updatedAt: adjustment.updatedAt.toISOString(),
  };
}

function toScaled(value: string): bigint {
  const normalized = value.trim();
  if (!normalized) return 0n;
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const scaled =
    BigInt(whole || '0') * QUANTITY_SCALE + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  return negative ? -scaled : scaled;
}

function scaledToDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = absolute % QUANTITY_SCALE;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(4, '0')}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
