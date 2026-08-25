import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type Prisma, type RecurringCadence } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { advanceCadence } from '../common/cadence.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { ExpensesService } from './expenses.service.js';
import type {
  CreateRecurringExpenseTemplateDto,
  UpdateRecurringExpenseTemplateDto,
} from './recurring-expenses.dto.js';

const RECURRING_EXPENSE_GENERATE_OPERATION = 'RECURRING_EXPENSE_GENERATE';

type TemplateWithDetail = Prisma.RecurringExpenseTemplateGetPayload<{
  include: typeof templateDetailInclude;
}>;

const templateDetailInclude = {
  payeeVendor: { select: { id: true, displayName: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.RecurringExpenseTemplateInclude;

/**
 * Generates real expenses via `ExpensesService#createDraft`/`post` -- mirrors
 * `RecurringInvoicesService`/`RecurringBillsService` exactly, including the `claimOccurrence`
 * atomicity primitive. Since Expense has no lines, this template carries the amount/tax fields
 * directly rather than resolving a lines array.
 */
@Injectable()
export class RecurringExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpensesService,
  ) {}

  async list(organizationId: string, active?: string) {
    const templates = await this.prisma.recurringExpenseTemplate.findMany({
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
    input: CreateRecurringExpenseTemplateDto,
    metadata: RequestMetadata,
  ) {
    if (!input.payeeVendorId && !input.payeeName) {
      throw new BadRequestException(
        'A recurring expense needs a vendor or a free-text payee name.',
      );
    }
    if (input.payeeVendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: input.payeeVendorId, organizationId: context.id },
      });
      if (!vendor) throw new NotFoundException('Vendor not found.');
      if (vendor.status !== 'ACTIVE') {
        throw new ConflictException('Cannot create a recurring template for a deactivated vendor.');
      }
    }
    if (input.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: input.categoryId, organizationId: context.id },
      });
      if (!category) throw new NotFoundException('Expense category not found.');
    }
    const paidThroughAccount = await this.prisma.ledgerAccount.findFirst({
      where: { id: input.paidThroughAccountId, organizationId: context.id },
    });
    if (!paidThroughAccount) throw new NotFoundException('Paid-through account not found.');

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { baseCurrency: true },
    });
    const currency = input.currency ?? organization.baseCurrency;
    const amountMinor = BigInt(input.amountMinor);
    if (amountMinor <= 0n)
      throw new BadRequestException('The expense amount must be greater than zero.');
    const startDate = isoDate(input.startDate);
    const endDate = input.endDate ? isoDate(input.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.recurringExpenseTemplate.create({
        data: {
          organizationId: context.id,
          payeeVendorId: input.payeeVendorId ?? null,
          payeeName: input.payeeName ?? null,
          cadence: input.cadence as RecurringCadence,
          startDate,
          endDate,
          nextRunDate: startDate,
          autoCreate: input.autoCreate ?? true,
          paidThroughAccountId: paidThroughAccount.id,
          categoryId: input.categoryId ?? null,
          currency,
          amountMinor,
          taxCodeId: input.taxCodeId ?? null,
          createdByUserId: user.id,
        },
        include: templateDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.recurring_expense_template_created',
        entityType: 'recurring_expense_template',
        entityId: template.id,
        action: AuditAction.CREATE,
        after: { amountMinor: amountMinor.toString(), cadence: template.cadence },
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
    input: UpdateRecurringExpenseTemplateDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, templateId);
    if (input.payeeVendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: input.payeeVendorId, organizationId: context.id },
      });
      if (!vendor) throw new NotFoundException('Vendor not found.');
      if (vendor.status !== 'ACTIVE') {
        throw new ConflictException('Cannot use a deactivated vendor.');
      }
    }
    if (input.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: input.categoryId, organizationId: context.id },
      });
      if (!category) throw new NotFoundException('Expense category not found.');
    }
    if (input.paidThroughAccountId) {
      const account = await this.prisma.ledgerAccount.findFirst({
        where: { id: input.paidThroughAccountId, organizationId: context.id },
      });
      if (!account) throw new NotFoundException('Paid-through account not found.');
    }

    const amountMinor = input.amountMinor ? BigInt(input.amountMinor) : existing.amountMinor;
    if (amountMinor <= 0n)
      throw new BadRequestException('The expense amount must be greater than zero.');
    const endDate = input.endDate !== undefined ? isoDate(input.endDate) : existing.endDate;

    const updated = await this.prisma.$transaction(async (tx) => {
      const template = await tx.recurringExpenseTemplate.update({
        where: { id: templateId },
        data: {
          payeeVendorId:
            input.payeeVendorId !== undefined ? input.payeeVendorId : existing.payeeVendorId,
          payeeName: input.payeeName !== undefined ? input.payeeName : existing.payeeName,
          cadence: (input.cadence as RecurringCadence) ?? existing.cadence,
          endDate,
          autoCreate: input.autoCreate ?? existing.autoCreate,
          paidThroughAccountId: input.paidThroughAccountId ?? existing.paidThroughAccountId,
          categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
          currency: input.currency ?? existing.currency,
          amountMinor,
          taxCodeId: input.taxCodeId !== undefined ? input.taxCodeId : existing.taxCodeId,
        },
        include: templateDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.recurring_expense_template_updated',
        entityType: 'recurring_expense_template',
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
    const due = await this.prisma.recurringExpenseTemplate.findMany({
      where: { organizationId: context.id, active: true, nextRunDate: { lte: today } },
      include: templateDetailInclude,
      orderBy: [{ nextRunDate: 'asc' }],
    });

    const results: Array<{ templateId: string; expenseId: string | null }> = [];

    for (const template of due) {
      const occurrenceDate = dateOnly(template.nextRunDate);
      const claimed = await this.claimOccurrence(context.id, template.id, occurrenceDate);
      if (!claimed) continue;

      const expense = await this.expenses.createDraft(
        context,
        user,
        {
          payeeVendorId: template.payeeVendorId ?? undefined,
          payeeName: template.payeeVendorId ? undefined : (template.payeeName ?? undefined),
          expenseDate: occurrenceDate,
          paidThroughAccountId: template.paidThroughAccountId,
          categoryId: template.categoryId ?? undefined,
          currency: template.currency,
          amountMinor: template.amountMinor.toString(),
          taxCodeId: template.taxCodeId ?? undefined,
        },
        metadata,
      );
      const expenseId: string = expense.id;

      if (template.autoCreate) {
        await this.expenses.post(context, user, expense.id, metadata);
      }

      const nextOccurrence = advanceCadence(template.nextRunDate, template.cadence);
      const stillActive = template.endDate ? nextOccurrence <= template.endDate : true;

      await this.prisma.$transaction(async (tx) => {
        await tx.recurringExpenseTemplate.update({
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
          eventKey: 'purchases.recurring_expense_generated',
          entityType: 'recurring_expense_template',
          entityId: template.id,
          action: AuditAction.UPDATE,
          after: { expenseId, occurrenceDate },
          ipHash: metadata.ipHash,
        });
      });

      results.push({ templateId: template.id, expenseId });
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
      const lockKey = `${organizationId}:${RECURRING_EXPENSE_GENERATE_OPERATION}:${key}`;
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
      `;
      const existing = await tx.ledgerIdempotencyKey.findUnique({
        where: {
          organizationId_operation_key: {
            organizationId,
            operation: RECURRING_EXPENSE_GENERATE_OPERATION,
            key,
          },
        },
      });
      if (existing) return false;
      await tx.ledgerIdempotencyKey.create({
        data: {
          organizationId,
          operation: RECURRING_EXPENSE_GENERATE_OPERATION,
          key,
          resourceType: 'RECURRING_EXPENSE_TEMPLATE',
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
      const template = await tx.recurringExpenseTemplate.update({
        where: { id: templateId },
        data: { active },
        include: templateDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: active
          ? 'purchases.recurring_expense_template_reactivated'
          : 'purchases.recurring_expense_template_deactivated',
        entityType: 'recurring_expense_template',
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
    const template = await this.prisma.recurringExpenseTemplate.findFirst({
      where: { id: templateId, organizationId },
      include: templateDetailInclude,
    });
    if (!template) throw new NotFoundException('Recurring expense template not found.');
    return template;
  }
}

function summarizeTemplate(template: TemplateWithDetail) {
  return {
    id: template.id,
    payeeVendorId: template.payeeVendorId,
    payeeVendorName: template.payeeVendor?.displayName ?? null,
    payeeName: template.payeeName,
    cadence: template.cadence,
    startDate: dateOnly(template.startDate),
    endDate: template.endDate ? dateOnly(template.endDate) : null,
    nextRunDate: dateOnly(template.nextRunDate),
    autoCreate: template.autoCreate,
    active: template.active,
    paidThroughAccountId: template.paidThroughAccountId,
    categoryId: template.categoryId,
    categoryName: template.category?.name ?? null,
    currency: template.currency,
    amountMinor: template.amountMinor.toString(),
    taxCodeId: template.taxCodeId,
    lastRunOccurrenceKey: template.lastRunOccurrenceKey,
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
