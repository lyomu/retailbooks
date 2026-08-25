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
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { InvoicesService } from './invoices.service.js';
import type {
  CreateRecurringInvoiceTemplateDto,
  RecurringInvoiceTemplateLineDto,
  UpdateRecurringInvoiceTemplateDto,
} from './recurring-invoices.dto.js';

const QUANTITY_SCALE = 10_000n;
const RECURRING_INVOICE_GENERATE_OPERATION = 'RECURRING_INVOICE_GENERATE';

type TemplateWithLines = Prisma.RecurringInvoiceTemplateGetPayload<{
  include: typeof templateDetailInclude;
}>;

const templateDetailInclude = {
  lines: { orderBy: { lineNumber: 'asc' } },
  contact: { select: { id: true, displayName: true, currency: true } },
} satisfies Prisma.RecurringInvoiceTemplateInclude;

/**
 * Generates real invoices via `InvoicesService#createDraft`/`issueInvoice`/`sendInvoice` -- no new
 * posting logic lives here. The one money-invariant this milestone must prove is that a duplicate
 * sweep trigger can never double-generate for the same due occurrence; `claimOccurrence` is the
 * atomic piece that guarantees it, using the same advisory-lock + `LedgerIdempotencyKey` pattern
 * already proven for Invoices/Payments/Credit Notes.
 */
@Injectable()
export class RecurringInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  async list(organizationId: string, active?: string) {
    const templates = await this.prisma.recurringInvoiceTemplate.findMany({
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
    input: CreateRecurringInvoiceTemplateDto,
    metadata: RequestMetadata,
  ) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
    });
    if (!contact) throw new NotFoundException('Customer not found.');
    if (contact.status !== 'ACTIVE') {
      throw new ConflictException('Cannot create a recurring template for a deactivated customer.');
    }
    const currency = input.currency ?? contact.currency;
    const resolvedLines = await this.resolveLines(context.id, input.lines);
    const startDate = isoDate(input.startDate);
    const endDate = input.endDate ? isoDate(input.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.recurringInvoiceTemplate.create({
        data: {
          organizationId: context.id,
          contactId: contact.id,
          cadence: input.cadence as RecurringCadence,
          startDate,
          endDate,
          nextRunDate: startDate,
          autoCreate: input.autoCreate ?? true,
          autoSend: input.autoSend ?? false,
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
        eventKey: 'sales.recurring_invoice_template_created',
        entityType: 'recurring_invoice_template',
        entityId: template.id,
        action: AuditAction.CREATE,
        after: { contactId: contact.id, cadence: template.cadence },
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
    input: UpdateRecurringInvoiceTemplateDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, templateId);

    let contactId = existing.contactId;
    if (input.contactId && input.contactId !== existing.contactId) {
      const nextContact = await this.prisma.contact.findFirst({
        where: { id: input.contactId, organizationId: context.id, type: 'CUSTOMER' },
      });
      if (!nextContact) throw new NotFoundException('Customer not found.');
      if (nextContact.status !== 'ACTIVE') {
        throw new ConflictException('Cannot use a deactivated customer.');
      }
      contactId = nextContact.id;
    }

    const resolvedLines = input.lines ? await this.resolveLines(context.id, input.lines) : null;
    const endDate = input.endDate !== undefined ? isoDate(input.endDate) : existing.endDate;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.recurringInvoiceTemplateLine.deleteMany({ where: { templateId } });
      }
      const template = await tx.recurringInvoiceTemplate.update({
        where: { id: templateId },
        data: {
          contactId,
          cadence: (input.cadence as RecurringCadence) ?? existing.cadence,
          endDate,
          autoCreate: input.autoCreate ?? existing.autoCreate,
          autoSend: input.autoSend ?? existing.autoSend,
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
        eventKey: 'sales.recurring_invoice_template_updated',
        entityType: 'recurring_invoice_template',
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

  /**
   * Sweeps every active, due template. For each: `claimOccurrence` atomically decides whether this
   * call gets to generate it (advisory lock + `LedgerIdempotencyKey` check-and-record, all inside one
   * short transaction) -- if another concurrent sweep already claimed it, this call skips it entirely.
   * Only after a successful claim does it call `createDraft`/`issueInvoice`/`sendInvoice`, each of
   * which opens its own transaction (same two-phase shape as Quote/SalesOrder conversion): the claim
   * itself is what's atomic, so two concurrent sweeps can never both win it for the same occurrence.
   */
  async runDueTemplates(context: OrganizationContext, user: PublicUser, metadata: RequestMetadata) {
    const today = isoDate(dateOnly(new Date()));
    const due = await this.prisma.recurringInvoiceTemplate.findMany({
      where: { organizationId: context.id, active: true, nextRunDate: { lte: today } },
      include: templateDetailInclude,
      orderBy: [{ nextRunDate: 'asc' }],
    });

    const results: Array<{ templateId: string; invoiceId: string | null }> = [];

    for (const template of due) {
      const occurrenceDate = dateOnly(template.nextRunDate);
      const claimed = await this.claimOccurrence(context.id, template.id, occurrenceDate);
      if (!claimed) continue;

      const invoice = await this.invoices.createDraft(
        context,
        user,
        {
          contactId: template.contactId,
          currency: template.currency,
          lines: template.lines.map((line) => ({
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
      const invoiceId: string = invoice.id;

      if (template.autoCreate) {
        const issued = await this.invoices.issueInvoice(context, user, invoice.id, metadata);
        if (template.autoSend) {
          await this.invoices.sendInvoice(context, user, issued.id, metadata);
        }
      }

      const nextOccurrence = advanceCadence(template.nextRunDate, template.cadence);
      const stillActive = template.endDate ? nextOccurrence <= template.endDate : true;

      await this.prisma.$transaction(async (tx) => {
        await tx.recurringInvoiceTemplate.update({
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
          eventKey: 'sales.recurring_invoice_generated',
          entityType: 'recurring_invoice_template',
          entityId: template.id,
          action: AuditAction.UPDATE,
          after: { invoiceId, occurrenceDate },
          ipHash: metadata.ipHash,
        });
      });

      results.push({ templateId: template.id, invoiceId });
    }

    return results;
  }

  /** Returns true if this call successfully claimed the occurrence (caller should proceed to
   * generate); false if another call already claimed it (caller should skip). */
  private async claimOccurrence(
    organizationId: string,
    templateId: string,
    occurrenceDate: string,
  ): Promise<boolean> {
    const key = `${templateId}:${occurrenceDate}`;
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `${organizationId}:${RECURRING_INVOICE_GENERATE_OPERATION}:${key}`;
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
      `;
      const existing = await tx.ledgerIdempotencyKey.findUnique({
        where: {
          organizationId_operation_key: {
            organizationId,
            operation: RECURRING_INVOICE_GENERATE_OPERATION,
            key,
          },
        },
      });
      if (existing) return false;
      await tx.ledgerIdempotencyKey.create({
        data: {
          organizationId,
          operation: RECURRING_INVOICE_GENERATE_OPERATION,
          key,
          resourceType: 'RECURRING_INVOICE_TEMPLATE',
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
      const template = await tx.recurringInvoiceTemplate.update({
        where: { id: templateId },
        data: { active },
        include: templateDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: active
          ? 'sales.recurring_invoice_template_reactivated'
          : 'sales.recurring_invoice_template_deactivated',
        entityType: 'recurring_invoice_template',
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
    const template = await this.prisma.recurringInvoiceTemplate.findFirst({
      where: { id: templateId, organizationId },
      include: templateDetailInclude,
    });
    if (!template) throw new NotFoundException('Recurring invoice template not found.');
    return template;
  }

  private async resolveLines(
    organizationId: string,
    lines: readonly RecurringInvoiceTemplateLineDto[],
  ) {
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

function summarizeTemplate(template: TemplateWithLines) {
  return {
    id: template.id,
    contactId: template.contactId,
    contactName: template.contact.displayName,
    cadence: template.cadence,
    startDate: dateOnly(template.startDate),
    endDate: template.endDate ? dateOnly(template.endDate) : null,
    nextRunDate: dateOnly(template.nextRunDate),
    autoCreate: template.autoCreate,
    autoSend: template.autoSend,
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
    })),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

function advanceCadence(date: Date, cadence: RecurringCadence): Date {
  if (cadence === 'WEEKLY') {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const months = cadence === 'MONTHLY' ? 1 : cadence === 'QUARTERLY' ? 3 : 12;
  return addMonthsClamped(date, months);
}

/**
 * Adds whole months to a UTC date, clamping the day-of-month to the last valid day of the target
 * month rather than letting it overflow into the following month -- `Date.prototype.setUTCMonth`
 * overflows when the target month is shorter than the source day-of-month (e.g. Jan 31 + 1 month
 * would otherwise become Mar 3, not Feb 28/29).
 */
function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, daysInTargetMonth));
  return next;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
