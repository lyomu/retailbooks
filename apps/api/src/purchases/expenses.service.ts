import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, type ExpenseStatus, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { EXPENSE_DOCUMENT_TYPE } from '../organizations/document-numbering.js';
import { DocumentNumberingService } from '../organizations/document-numbering.service.js';
import { LedgerService } from '../organizations/ledger.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { TaxService } from '../organizations/tax.service.js';
import type { CreateExpenseDto, UpdateExpenseDto } from './expenses.dto.js';

type ExpenseWithDetail = Prisma.ExpenseGetPayload<{ include: typeof expenseDetailInclude }>;

const expenseDetailInclude = {
  payeeVendor: { select: { id: true, displayName: true } },
  category: { select: { id: true, name: true, accountId: true } },
} satisfies Prisma.ExpenseInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly tax: TaxService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async list(organizationId: string, status?: string) {
    const expenses = await this.prisma.expense.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      include: expenseDetailInclude,
      take: 200,
    });
    return expenses.map(summarizeExpense);
  }

  async detail(organizationId: string, expenseId: string) {
    const expense = await this.findOrThrow(organizationId, expenseId);
    return summarizeExpense(expense);
  }

  async createDraft(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateExpenseDto,
    metadata: RequestMetadata,
  ) {
    if (!input.payeeVendorId && !input.payeeName) {
      throw new BadRequestException('An expense needs a vendor or a free-text payee name.');
    }
    if (input.payeeVendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: input.payeeVendorId, organizationId: context.id },
      });
      if (!vendor) throw new NotFoundException('Vendor not found.');
      if (vendor.status !== 'ACTIVE') {
        throw new ConflictException('Cannot record an expense for a deactivated vendor.');
      }
    }
    if (input.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: input.categoryId, organizationId: context.id },
      });
      if (!category) throw new NotFoundException('Expense category not found.');
    }
    if (input.projectId) await this.requireProject(context.id, input.projectId);
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

    const created = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          organizationId: context.id,
          payeeVendorId: input.payeeVendorId ?? null,
          payeeName: input.payeeName ?? null,
          expenseDate: isoDate(input.expenseDate),
          paidThroughAccountId: paidThroughAccount.id,
          categoryId: input.categoryId ?? null,
          projectId: input.projectId ?? null,
          currency,
          amountMinor,
          totalMinor: amountMinor,
          taxCodeId: input.taxCodeId ?? null,
          createdByUserId: user.id,
        },
        include: expenseDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.expense_created',
        entityType: 'expense',
        entityId: expense.id,
        action: AuditAction.CREATE,
        after: { amountMinor: amountMinor.toString() },
        ipHash: metadata.ipHash,
      });
      return expense;
    });

    return summarizeExpense(created);
  }

  async updateDraft(
    context: OrganizationContext,
    user: PublicUser,
    expenseId: string,
    input: UpdateExpenseDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, expenseId);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('Only draft expenses can be edited.');
    }
    if (input.payeeVendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: input.payeeVendorId, organizationId: context.id },
      });
      if (!vendor) throw new NotFoundException('Vendor not found.');
      if (vendor.status !== 'ACTIVE') {
        throw new ConflictException('Cannot record an expense for a deactivated vendor.');
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
    if (input.projectId) await this.requireProject(context.id, input.projectId);

    const amountMinor = input.amountMinor ? BigInt(input.amountMinor) : existing.amountMinor;
    if (amountMinor <= 0n)
      throw new BadRequestException('The expense amount must be greater than zero.');

    const updated = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
        where: { id: expenseId },
        data: {
          payeeVendorId:
            input.payeeVendorId !== undefined ? input.payeeVendorId : existing.payeeVendorId,
          payeeName: input.payeeName !== undefined ? input.payeeName : existing.payeeName,
          expenseDate: input.expenseDate ? isoDate(input.expenseDate) : existing.expenseDate,
          paidThroughAccountId: input.paidThroughAccountId ?? existing.paidThroughAccountId,
          categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
          projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
          currency: input.currency ?? existing.currency,
          amountMinor,
          totalMinor: amountMinor,
          taxCodeId: input.taxCodeId !== undefined ? input.taxCodeId : existing.taxCodeId,
        },
        include: expenseDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.expense_updated',
        entityType: 'expense',
        entityId: expenseId,
        action: AuditAction.UPDATE,
        before: { amountMinor: existing.amountMinor.toString() },
        after: { amountMinor: amountMinor.toString() },
        ipHash: metadata.ipHash,
      });
      return expense;
    });

    return summarizeExpense(updated);
  }

  submit(
    context: OrganizationContext,
    user: PublicUser,
    expenseId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, expenseId, metadata, {
      from: ['DRAFT'],
      to: 'PENDING_APPROVAL',
      eventKey: 'purchases.expense_submitted',
      errorMessage: 'Only draft expenses can be submitted for approval.',
    });
  }

  approve(
    context: OrganizationContext,
    user: PublicUser,
    expenseId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, expenseId, metadata, {
      from: ['PENDING_APPROVAL'],
      to: 'APPROVED',
      eventKey: 'purchases.expense_approved',
      errorMessage: 'Only expenses pending approval can be approved.',
    });
  }

  cancel(
    context: OrganizationContext,
    user: PublicUser,
    expenseId: string,
    metadata: RequestMetadata,
  ) {
    return this.transition(context, user, expenseId, metadata, {
      from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'],
      to: 'CANCELLED',
      eventKey: 'purchases.expense_cancelled',
      errorMessage: 'Posted or voided expenses cannot be cancelled.',
    });
  }

  /**
   * Posts the expense: debits the category's mapped account (or `general_expense` if no category)
   * plus recoverable tax, credits the paid-through account directly -- immediate cash-out, no AP
   * leg. Mirrors `BillsService#issueBill`'s idempotency-lock/row-lock/tax-freeze/post/
   * number-allocate shape, collapsed to the expense's single amount instead of a lines array.
   * Reachable from DRAFT or APPROVED -- "approval configurable" is permission-gated, not a status
   * gate: anyone holding `purchases.expenses.post` can post straight from DRAFT.
   */
  async post(
    context: OrganizationContext,
    user: PublicUser,
    expenseId: string,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const posted = await this.prisma.$transaction(async (tx) => {
      await this.lockExpenseIdempotency(tx, context.id, idempotencyKey);
      const existingResult = await this.findExpenseIdempotentResult(context.id, idempotencyKey, tx);
      if (existingResult) {
        return tx.expense.findFirstOrThrow({
          where: { id: existingResult.resourceId, organizationId: context.id },
          include: expenseDetailInclude,
        });
      }

      await this.lockExpenseRow(tx, context.id, expenseId);
      const expense = await tx.expense.findFirst({
        where: { id: expenseId, organizationId: context.id },
        include: expenseDetailInclude,
      });
      if (!expense) throw new NotFoundException('Expense not found.');
      if (expense.status !== 'DRAFT' && expense.status !== 'APPROVED') {
        throw new ConflictException('Only draft or approved expenses can be posted.');
      }

      const postDate = dateOnly(new Date());
      const payeeLabel = expense.payeeVendor?.displayName ?? expense.payeeName ?? 'payee';

      const expenseAccountId =
        expense.category?.accountId ??
        (await this.ledger.accountBySystemKey(context.id, 'general_expense', tx)).id;

      let taxAmountMinor = 0n;
      let taxAccountId: string | null = null;
      if (expense.taxCodeId) {
        const resolved = await this.tax.resolveForPosting(
          tx,
          context.id,
          expense.taxCodeId,
          expense.amountMinor,
          postDate,
        );
        await tx.expense.update({
          where: { id: expense.id },
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
          taxAmountMinor = resolved.taxAmountMinor;
          taxAccountId =
            resolved.purchaseTaxAccountId ??
            (await this.ledger.accountBySystemKey(context.id, 'tax_receivable', tx)).id;
        }
      }

      const totalMinor = expense.amountMinor + taxAmountMinor;

      const journalLines = [
        {
          accountId: expenseAccountId,
          debitMinor: expense.amountMinor,
          creditMinor: 0n,
          description: `Expense: ${payeeLabel}`,
          // Decision D1: the cost line carries the project, frozen here at posting. Only the
          // expense leg is dimensioned -- the tax and payment legs are not this project's cost.
          projectId: expense.projectId ?? undefined,
        },
        ...(taxAmountMinor > 0n && taxAccountId
          ? [
              {
                accountId: taxAccountId,
                debitMinor: taxAmountMinor,
                creditMinor: 0n,
                description: `Expense recoverable tax: ${payeeLabel}`,
              },
            ]
          : []),
        {
          accountId: expense.paidThroughAccountId,
          debitMinor: 0n,
          creditMinor: totalMinor,
          description: `Expense: ${payeeLabel}`,
        },
      ];

      const postedJournal = await this.ledger.postJournalFromLines(
        context,
        user,
        'EXPENSE_POST',
        {
          journalDate: new Date(`${postDate}T00:00:00.000Z`),
          currency: expense.currency,
          description: `Expense: ${payeeLabel}`,
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          lines: journalLines,
        },
        metadata,
        undefined,
        tx,
      );

      const allocation = await this.numbering.allocateDocumentNumberWithClient(
        tx,
        context.id,
        EXPENSE_DOCUMENT_TYPE,
        new Date(`${postDate}T00:00:00.000Z`),
      );

      const updated = await tx.expense.update({
        where: { id: expenseId },
        data: {
          status: 'POSTED',
          expenseNumber: allocation.value,
          totalMinor,
          journalId: postedJournal.id,
        },
        include: expenseDetailInclude,
      });

      await this.recordExpenseIdempotency(tx, context.id, idempotencyKey, expenseId);
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.expense_posted',
        entityType: 'expense',
        entityId: expenseId,
        action: AuditAction.UPDATE,
        before: { status: expense.status },
        after: { status: 'POSTED', expenseNumber: allocation.value },
        ipHash: metadata.ipHash,
      });

      return updated;
    });

    return summarizeExpense(posted);
  }

  /** Mirrors `BillsService#voidBill`, simplified: an Expense has no partial-payment concept
   * (immediate full cash-out), so there is no `paidMinor` guard -- only a posted journal to
   * reverse. */
  async voidExpense(
    context: OrganizationContext,
    user: PublicUser,
    expenseId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, expenseId);
    if (existing.status !== 'POSTED') {
      throw new ConflictException('Only posted expenses can be voided.');
    }
    if (!existing.journalId) {
      throw new ConflictException('This expense has no posted journal to reverse.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseJournal(
        context,
        user,
        existing.journalId!,
        { description: `Void of expense ${existing.expenseNumber ?? existing.id}` },
        metadata,
        undefined,
        tx,
      );

      const expense = await tx.expense.update({
        where: { id: expenseId },
        data: { status: 'VOID', voidedAt: new Date() },
        include: expenseDetailInclude,
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.expense_voided',
        entityType: 'expense',
        entityId: expenseId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: 'VOID' },
        ipHash: metadata.ipHash,
      });

      return expense;
    });

    return summarizeExpense(updated);
  }

  private async transition(
    context: OrganizationContext,
    user: PublicUser,
    expenseId: string,
    metadata: RequestMetadata,
    options: {
      from: readonly ExpenseStatus[];
      to: ExpenseStatus;
      eventKey: string;
      errorMessage: string;
    },
  ) {
    const existing = await this.findOrThrow(context.id, expenseId);
    if (!options.from.includes(existing.status)) {
      throw new ConflictException(options.errorMessage);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.update({
        where: { id: expenseId },
        data: { status: options.to },
        include: expenseDetailInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: options.eventKey,
        entityType: 'expense',
        entityId: expenseId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: options.to },
        ipHash: metadata.ipHash,
      });
      return expense;
    });
    return summarizeExpense(updated);
  }

  private async findOrThrow(organizationId: string, expenseId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, organizationId },
      include: expenseDetailInclude,
    });
    if (!expense) throw new NotFoundException('Expense not found.');
    return expense;
  }

  private async lockExpenseIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key?: string,
  ): Promise<void> {
    if (!key) return;
    const lockKey = `${organizationId}:EXPENSE_POST:${key}`;
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
    `;
  }

  private async findExpenseIdempotentResult(
    organizationId: string,
    key: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<{ resourceId: string } | null> {
    if (!key) return null;
    return tx.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: { organizationId, operation: 'EXPENSE_POST_EXPENSE', key },
      },
      select: { resourceId: true },
    });
  }

  private recordExpenseIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key: string | undefined,
    expenseId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation: 'EXPENSE_POST_EXPENSE',
        key,
        resourceType: 'EXPENSE',
        resourceId: expenseId,
      },
    });
  }

  /**
   * A closed project stops accepting new cost the same way it stops accepting new time -- otherwise
   * a completed project's margin could move after it was reported.
   */
  private async requireProject(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
    if (project.status === 'COMPLETED' || project.status === 'CANCELLED') {
      throw new ConflictException(
        `Cannot attribute an expense to a ${project.status.toLowerCase()} project.`,
      );
    }
    return project;
  }

  private async lockExpenseRow(
    tx: Prisma.TransactionClient,
    organizationId: string,
    expenseId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT id
      FROM expenses
      WHERE id = ${expenseId}::uuid AND organization_id = ${organizationId}::uuid
      FOR UPDATE
    `;
  }
}

function summarizeExpense(expense: ExpenseWithDetail) {
  return {
    id: expense.id,
    payeeVendorId: expense.payeeVendorId,
    payeeVendorName: expense.payeeVendor?.displayName ?? null,
    payeeName: expense.payeeName,
    expenseNumber: expense.expenseNumber,
    status: expense.status,
    expenseDate: dateOnly(expense.expenseDate),
    paidThroughAccountId: expense.paidThroughAccountId,
    categoryId: expense.categoryId,
    projectId: expense.projectId,
    categoryName: expense.category?.name ?? null,
    currency: expense.currency,
    amountMinor: expense.amountMinor.toString(),
    taxCodeId: expense.taxCodeId,
    taxCodeSnapshot: expense.taxCodeSnapshot,
    taxTreatmentSnapshot: expense.taxTreatmentSnapshot,
    taxRecoverableSnapshot: expense.taxRecoverableSnapshot,
    taxRatePercentSnapshot: expense.taxRatePercentSnapshot?.toString() ?? null,
    taxableAmountMinor: expense.taxableAmountMinor?.toString() ?? null,
    taxAmountMinor: expense.taxAmountMinor?.toString() ?? null,
    totalMinor: expense.totalMinor.toString(),
    journalId: expense.journalId,
    voidedAt: expense.voidedAt?.toISOString() ?? null,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
