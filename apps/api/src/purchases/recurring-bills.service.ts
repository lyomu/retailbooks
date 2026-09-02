import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma, type RecurringCadence } from '@prisma/client';
import { roundHalfUpDivide } from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { advanceCadence } from '../common/cadence.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { BillsService } from './bills.service.js';
import type {
  CreateRecurringBillTemplateDto,
  RecurringBillTemplateLineDto,
  UpdateRecurringBillTemplateDto,
} from './recurring-bills.dto.js';

const QUANTITY_SCALE = 10_000n;
const RECURRING_BILL_GENERATE_OPERATION = 'RECURRING_BILL_GENERATE';

type TemplateWithLines = Prisma.RecurringBillTemplateGetPayload<{
  include: typeof templateDetailInclude;
}>;

const templateDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  vendor: { select: { id: true, displayName: true, currency: true } },
} satisfies Prisma.RecurringBillTemplateInclude;

/**
 * Generates real bills via `BillsService#createDraft`/`issueBill` -- mirrors
 * `RecurringInvoicesService` exactly, including its `claimOccurrence` atomicity primitive (advisory
 * lock + `LedgerIdempotencyKey` check-and-record) that guarantees a duplicate sweep trigger can
 * never double-generate for the same due occurrence.
 */
@Injectable()
export class RecurringBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bills: BillsService,
  ) {}

  async list(organizationId: string, active?: string) {
    const templates = await this.prisma.recurringBillTemplate.findMany({
      where: {
        organizationId,
        ...(active !== undefined ? { active: active === 'true' } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      include: templateDetailInclude,
      take: 200,
    });
    return templates.map(summarizeTemplate);
  }

  async detail(organizationId: string, templateId: string) {
    const template = await this.findOrThrow(organizationId, templateId);
    return summarizeTemplate(template);
  }

  async createTemplate(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateRecurringBillTemplateDto,
    metadata: RequestMetadata,
  ) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: input.vendorId, organizationId: context.id },
    });
    if (!vendor) throw new NotFoundException('Vendor not found.');
    if (vendor.status !== 'ACTIVE') {
      throw new ConflictException('Cannot create a recurring template for a deactivated vendor.');
    }
    const currency = input.currency ?? vendor.currency;
    const resolvedLines = await this.resolveLines(context.id, input.lines);
    const startDate = isoDate(input.startDate);
    const endDate = input.endDate ? isoDate(input.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.recurringBillTemplate.create({
        data: {
          organizationId: context.id,
          vendorId: vendor.id,
          cadence: input.cadence as RecurringCadence,
          startDate,
          endDate,
          nextRunDate: startDate,
          autoCreate: input.autoCreate ?? true,
          currency,
          createdByUserId: user.id,
          lines: {
            create: resolvedLines.map((line, index) => lineCreateData(line, index, context.id)),
          },
        },
        include: templateDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.recurring_bill_template_created',
        entityType: 'recurring_bill_template',
        entityId: template.id,
        action: AuditAction.CREATE,
        after: { vendorId: vendor.id, cadence: template.cadence },
        ipHash: metadata.ipHash,
      });

      return template;
    });

    return summarizeTemplate(created);
  }

  async updateTemplate(
    context: OrganizationContext,
    user: PublicUser,
    templateId: string,
    input: UpdateRecurringBillTemplateDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, templateId);

    let vendorId = existing.vendorId;
    if (input.vendorId && input.vendorId !== existing.vendorId) {
      const nextVendor = await this.prisma.vendor.findFirst({
        where: { id: input.vendorId, organizationId: context.id },
      });
      if (!nextVendor) throw new NotFoundException('Vendor not found.');
      if (nextVendor.status !== 'ACTIVE') {
        throw new ConflictException('Cannot use a deactivated vendor.');
      }
      vendorId = nextVendor.id;
    }

    const resolvedLines = input.lines ? await this.resolveLines(context.id, input.lines) : null;
    const endDate = input.endDate !== undefined ? isoDate(input.endDate) : existing.endDate;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.recurringBillTemplateLine.deleteMany({ where: { templateId } });
      }
      const template = await tx.recurringBillTemplate.update({
        where: { id: templateId },
        data: {
          vendorId,
          cadence: (input.cadence as RecurringCadence) ?? existing.cadence,
          endDate,
          autoCreate: input.autoCreate ?? existing.autoCreate,
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
        include: templateDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.recurring_bill_template_updated',
        entityType: 'recurring_bill_template',
        entityId: templateId,
        action: AuditAction.UPDATE,
        ipHash: metadata.ipHash,
      });

      return template;
    });

    return summarizeTemplate(updated);
  }

  async deactivate(
    context: OrganizationContext,
    user: PublicUser,
    templateId: string,
    metadata: RequestMetadata,
  ) {
    return this.setActive(context, user, templateId, false, metadata);
  }

  async reactivate(
    context: OrganizationContext,
    user: PublicUser,
    templateId: string,
    metadata: RequestMetadata,
  ) {
    return this.setActive(context, user, templateId, true, metadata);
  }

  async runDueTemplates(context: OrganizationContext, user: PublicUser, metadata: RequestMetadata) {
    const today = isoDate(dateOnly(new Date()));
    const due = await this.prisma.recurringBillTemplate.findMany({
      where: { organizationId: context.id, active: true, nextRunDate: { lte: today } },
      include: templateDetailInclude,
      orderBy: [{ nextRunDate: 'asc' }],
    });

    const results: Array<{ templateId: string; billId: string | null }> = [];

    for (const template of due) {
      const occurrenceDate = dateOnly(template.nextRunDate);
      const claimed = await this.claimOccurrence(context.id, template.id, occurrenceDate);
      if (!claimed) continue;

      const bill = await this.bills.createDraft(
        context,
        user,
        {
          vendorId: template.vendorId,
          currency: template.currency,
          lines: template.lines.map((line) => ({
            itemId: line.itemId ?? undefined,
            description: line.itemId ? undefined : line.descriptionSnapshot,
            quantity: line.quantity.toString(),
            unitPriceMinor: line.unitPriceMinor.toString(),
            discountMinor: line.discountMinor.toString(),
            taxCodeId: line.taxCodeId ?? undefined,
            accountId: line.accountId ?? undefined,
          })),
        },
        metadata,
      );
      const billId: string = bill.id;

      if (template.autoCreate) {
        await this.bills.issueBill(context, user, bill.id, metadata);
      }

      const nextOccurrence = advanceCadence(template.nextRunDate, template.cadence);
      const stillActive = template.endDate ? nextOccurrence <= template.endDate : true;

      await this.prisma.$transaction(async (tx) => {
        await tx.recurringBillTemplate.update({
          where: { id: template.id },
          data: {
            nextRunDate: nextOccurrence,
            lastRunOccurrenceKey: occurrenceDate,
            active: stillActive,
          },
        });
        await writeAuditEvent(tx, {
          organizationId: context.id,
          actorUserId: user.id,
          eventKey: 'purchases.recurring_bill_generated',
          entityType: 'recurring_bill_template',
          entityId: template.id,
          action: AuditAction.UPDATE,
          after: { billId, occurrenceDate },
          ipHash: metadata.ipHash,
        });
      });

      results.push({ templateId: template.id, billId });
    }

    return results;
  }

  private async claimOccurrence(
    organizationId: string,
    templateId: string,
    occurrenceDate: string,
  ): Promise<boolean> {
    const key = `${templateId}:${occurrenceDate}`;
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `${organizationId}:${RECURRING_BILL_GENERATE_OPERATION}:${key}`;
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
      `;
      const existing = await tx.ledgerIdempotencyKey.findUnique({
        where: {
          organizationId_operation_key: {
            organizationId,
            operation: RECURRING_BILL_GENERATE_OPERATION,
            key,
          },
        },
      });
      if (existing) return false;
      await tx.ledgerIdempotencyKey.create({
        data: {
          organizationId,
          operation: RECURRING_BILL_GENERATE_OPERATION,
          key,
          resourceType: 'RECURRING_BILL_TEMPLATE',
          resourceId: templateId,
        },
      });
      return true;
    });
  }

  private async setActive(
    context: OrganizationContext,
    user: PublicUser,
    templateId: string,
    active: boolean,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, templateId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const template = await tx.recurringBillTemplate.update({
        where: { id: templateId },
        data: { active },
        include: templateDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: active
          ? 'purchases.recurring_bill_template_reactivated'
          : 'purchases.recurring_bill_template_deactivated',
        entityType: 'recurring_bill_template',
        entityId: templateId,
        action: AuditAction.UPDATE,
        before: { active: existing.active },
        after: { active },
        ipHash: metadata.ipHash,
      });
      return template;
    });
    return summarizeTemplate(updated);
  }

  private async findOrThrow(organizationId: string, templateId: string) {
    const template = await this.prisma.recurringBillTemplate.findFirst({
      where: { id: templateId, organizationId },
      include: templateDetailInclude,
    });
    if (!template) throw new NotFoundException('Recurring bill template not found.');
    return template;
  }

  private async resolveLines(
    organizationId: string,
    lines: readonly RecurringBillTemplateLineDto[],
  ) {
    const itemIds = Array.from(
      new Set(lines.map((line) => line.itemId).filter((id): id is string => Boolean(id))),
    );
    const items =
      itemIds.length === 0
        ? []
        : await this.prisma.item.findMany({ where: { id: { in: itemIds }, organizationId } });
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const needsInventoryAccount = lines.some((line) => {
      const item = line.itemId ? itemsById.get(line.itemId) : undefined;
      return item?.inventoryTracked && !line.accountId && !item.purchaseAccountId;
    });
    const inventoryAccountId = needsInventoryAccount
      ? (
          await this.prisma.ledgerAccount.findUniqueOrThrow({
            where: { organizationId_systemKey: { organizationId, systemKey: 'inventory_asset' } },
          })
        ).id
      : null;

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
        taxCodeId:
          line.taxCodeId ?? item?.defaultPurchaseTaxCodeId ?? item?.defaultTaxCodeId ?? null,
        accountId:
          line.accountId ??
          item?.purchaseAccountId ??
          (item?.inventoryTracked ? inventoryAccountId : null),
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
    accountId: string | null;
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
    accountId: line.accountId,
    warehouseId: line.warehouseId,
  };
}

function summarizeTemplate(template: TemplateWithLines) {
  return {
    id: template.id,
    vendorId: template.vendorId,
    vendorName: template.vendor.displayName,
    cadence: template.cadence,
    startDate: dateOnly(template.startDate),
    endDate: template.endDate ? dateOnly(template.endDate) : null,
    nextRunDate: dateOnly(template.nextRunDate),
    autoCreate: template.autoCreate,
    active: template.active,
    currency: template.currency,
    lastRunOccurrenceKey: template.lastRunOccurrenceKey,
    lines: template.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      descriptionSnapshot: line.descriptionSnapshot,
      quantity: line.quantity.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      discountMinor: line.discountMinor.toString(),
      lineTotalMinor: line.lineTotalMinor.toString(),
      taxCodeId: line.taxCodeId,
      accountId: line.accountId,
      warehouseId: line.warehouseId,
    })),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
