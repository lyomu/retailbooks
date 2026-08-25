import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma, type SalesOrderStatus } from '@prisma/client';
import { roundHalfUpDivide } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { SALES_ORDER_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { InvoicesService } from './invoices.service.js';
import type {
  CreateSalesOrderDto,
  SalesOrderLineDto,
  UpdateSalesOrderDto,
} from './sales-orders.dto.js';

const QUANTITY_SCALE = 10_000n;
const CONVERTIBLE_STATUSES: readonly SalesOrderStatus[] = [
  'CONFIRMED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
];

type SalesOrderWithLines = Prisma.SalesOrderGetPayload<{ include: typeof orderDetailInclude }>;

const orderDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  contact: { select: { id: true, displayName: true, currency: true } },
} satisfies Prisma.SalesOrderInclude;

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly invoices: InvoicesService,
  ) {}

  async list(organizationId: string, status?: string) {
    const orders = await this.prisma.salesOrder.findMany({
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
    input: CreateSalesOrderDto,
    metadata: RequestMetadata,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    if (contact.status !== 'ACTIVE') {
      throw new ConflictException('Cannot create an order for a deactivated customer.');
    }
    const currency = input.currency ?? contact.currency;
    const resolvedLines = await this.resolveLines(context.id, input.lines);
    const totalMinor = resolvedLines.reduce((sum, line) => sum + line.lineTotalMinor, 0n);

    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.create({
        data: {
          organizationId: context.id,
          contactId: contact.id,
          currency,
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
        eventKey: 'sales.order_created',
        entityType: 'sales_order',
        entityId: order.id,
        action: AuditAction.CREATE,
        after: { contactId: contact.id, totalMinor: totalMinor.toString() },
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
    input: UpdateSalesOrderDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, orderId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft orders can be edited.');
    }

    let contact = existing.contact;
    if (input.contactId && input.contactId !== existing.contactId) {
      const nextContact = await this.prisma.contact.findFirst({
        where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
      });
      if (!nextContact) throw new NotFoundException('Customer not found.');
      if (nextContact.status !== 'ACTIVE') {
        throw new ConflictException('Cannot create an order for a deactivated customer.');
      }
      contact = {
        id: nextContact.id,
        displayName: nextContact.displayName,
        currency: nextContact.currency,
      };
    }

    const currency = input.currency ?? contact.currency;
    const resolvedLines = input.lines ? await this.resolveLines(context.id, input.lines) : null;
    const totalMinor = resolvedLines
      ? resolvedLines.reduce((sum, line) => sum + line.lineTotalMinor, 0n)
      : existing.totalMinor;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.salesOrderLine.deleteMany({ where: { salesOrderId: orderId } });
      }
      const order = await tx.salesOrder.update({
        where: { id: orderId },
        data: {
          contactId: contact.id,
          currency,
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
        eventKey: 'sales.order_updated',
        entityType: 'sales_order',
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

  /** DRAFT -> APPROVED. Allocates the order's number here, the first point it leaves an
   * internal-only state, mirroring Quotes' submit-for-approval numbering point. */
  async approve(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, orderId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft orders can be approved.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        SALES_ORDER_DOCUMENT_TYPE,
        new Date(),
      );
      const order = await tx.salesOrder.update({
        where: { id: orderId },
        data: {
          status: 'APPROVED',
          orderNumber: allocation.value,
          issueDate: isoDate(dateOnly(new Date())),
        },
        include: orderDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.order_approved',
        entityType: 'sales_order',
        entityId: orderId,
        action: AuditAction.UPDATE,
        before: { status: 'DRAFT' },
        after: { status: 'APPROVED', orderNumber: allocation.value },
        ipHash: metadata.ipHash,
      });
      return order;
    });
    return summarizeOrder(updated);
  }

  confirm(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, orderId, metadata, {
      from: ['APPROVED'],
      to: 'CONFIRMED',
      eventKey: 'sales.order_confirmed',
      errorMessage: 'Only approved orders can be confirmed.',
    });
  }

  markPartiallyFulfilled(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, orderId, metadata, {
      from: ['CONFIRMED', 'PARTIALLY_FULFILLED'],
      to: 'PARTIALLY_FULFILLED',
      eventKey: 'sales.order_partially_fulfilled',
      errorMessage: 'Only confirmed orders can be marked partially fulfilled.',
    });
  }

  markFulfilled(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, orderId, metadata, {
      from: ['CONFIRMED', 'PARTIALLY_FULFILLED'],
      to: 'FULFILLED',
      eventKey: 'sales.order_fulfilled',
      errorMessage: 'Only confirmed or partially fulfilled orders can be marked fulfilled.',
    });
  }

  cancel(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, orderId, metadata, {
      from: ['DRAFT', 'APPROVED', 'CONFIRMED'],
      to: 'CANCELLED',
      eventKey: 'sales.order_cancelled',
      errorMessage: 'Fulfilled orders cannot be cancelled.',
    });
  }

  /** Unlike Quote, SalesOrderStatus has no CONVERTED value -- fulfillment and invoicing are
   * independent, so conversion only sets `convertedInvoiceId` and leaves status untouched. Allowed
   * from CONFIRMED onward since Phase 6's inventory module doesn't exist yet to give "fulfilled" a
   * real stock meaning. */
  async convertToInvoice(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, orderId);
    if (!CONVERTIBLE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        'Only confirmed or fulfilled orders can be converted to an invoice.',
      );
    }
    if (existing.convertedInvoiceId) {
      throw new ConflictException('This order has already been converted to an invoice.');
    }

    const invoice = await this.invoices.createDraft(
      context,
      user,
      {
        contactId: existing.contactId,
        currency: existing.currency,
        lines: existing.lines.map((line) => ({
          itemId: line.itemId ?? undefined,
          description: line.itemId ? undefined : line.descriptionSnapshot,
          quantity: line.quantity.toString(),
          unitPriceMinor: line.unitPriceMinor.toString(),
          discountMinor: line.discountMinor.toString(),
          taxCodeId: line.taxCodeId ?? undefined,
        })),
      },
      metadata,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.update({
        where: { id: orderId },
        data: { convertedInvoiceId: invoice.id },
        include: orderDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'sales.order_converted',
        entityType: 'sales_order',
        entityId: orderId,
        action: AuditAction.UPDATE,
        after: { convertedInvoiceId: invoice.id },
        ipHash: metadata.ipHash,
      });
      return order;
    });

    return summarizeOrder(updated);
  }

  private async transition(
    context: OrganizationContext,
    user: PublicUser,
    orderId: string,
    metadata: RequestMetadata,
    options: {
      from: readonly SalesOrderStatus[];
      to: SalesOrderStatus;
      eventKey: string;
      errorMessage: string;
    },
  ) {
    const existing = await this.findOrThrow(context.id, orderId);
    if (!options.from.includes(existing.status)) {
      throw new ConflictException(options.errorMessage);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.update({
        where: { id: orderId },
        data: { status: options.to },
        include: orderDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: options.eventKey,
        entityType: 'sales_order',
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
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: orderId, organizationId },
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundException('Sales order not found.');
    return order;
  }

  private async resolveLines(organizationId: string, lines: readonly SalesOrderLineDto[]) {
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

      const unitPriceMinor = line.unitPriceMinor
        ? BigInt(line.unitPriceMinor)
        : resolveDefaultPrice(item, label);

      const discountMinor = line.discountMinor ? BigInt(line.discountMinor) : 0n;
      const lineTotalMinor = computeLineTotal(label, line.quantity, unitPriceMinor, discountMinor);

      return {
        itemId: item?.id ?? null,
        descriptionSnapshot,
        quantity: line.quantity,
        unitPriceMinor,
        discountMinor,
        lineTotalMinor,
        taxCodeId: line.taxCodeId ?? item?.defaultTaxCodeId ?? null,
      };
    });
  }
}

function resolveDefaultPrice(
  item: Prisma.ItemGetPayload<{ include: { prices: true } }> | undefined,
  label: string,
): bigint {
  const price = item?.prices.find((candidate) => candidate.priceListKey === 'default');
  if (!price) {
    throw new BadRequestException(`${label}: no unit price given and no default price found.`);
  }
  return price.unitPriceMinor;
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
  };
}

function summarizeOrder(order: SalesOrderWithLines) {
  return {
    id: order.id,
    contactId: order.contactId,
    contactName: order.contact.displayName,
    orderNumber: order.orderNumber,
    status: order.status,
    issueDate: order.issueDate ? dateOnly(order.issueDate) : null,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor.toString(),
    totalMinor: order.totalMinor.toString(),
    convertedInvoiceId: order.convertedInvoiceId,
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
