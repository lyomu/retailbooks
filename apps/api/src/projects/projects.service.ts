import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, TimeEntryStatus } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { InvoicesService } from '../sales/invoices.service.js';
import type {
  ChangeProjectStatusDto,
  CreateProjectDto,
  CreateProjectTaskDto,
  CreateTimeEntryDto,
  GenerateProjectInvoiceDto,
  LinkProjectExpenseDto,
  TimeDecisionDto,
  UpdateProjectDto,
  UpdateProjectExpenseDto,
  UpdateProjectTaskDto,
  UpdateTimeEntryDto,
  UpsertProjectBudgetDto,
} from './projects.dto.js';

/** Statuses whose time is finished being edited by the person who recorded it. */
const LOCKED_TIME_STATUSES: readonly TimeEntryStatus[] = [
  TimeEntryStatus.SUBMITTED,
  TimeEntryStatus.APPROVED,
  TimeEntryStatus.INVOICED,
];

/** A project in one of these states does not accept new work or new time. */
const CLOSED_PROJECT_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

const HOURS_SCALE = 100n;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoicesService,
  ) {}

  // --- projects ---------------------------------------------------------------------------------

  async list(organizationId: string, status?: string) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId, ...(status ? { status: status as never } : {}) },
      include: projectInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    return projects.map(summarizeProject);
  }

  async detail(organizationId: string, projectId: string) {
    return summarizeProject(await this.findProjectOrThrow(organizationId, projectId));
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateProjectDto,
    metadata: RequestMetadata,
  ) {
    const customer = await this.resolveCustomer(context.id, input.customerId);
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { baseCurrency: true },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          organizationId: context.id,
          name: input.name,
          code: input.code ?? null,
          customerId: customer?.id ?? null,
          managerUserId: input.managerUserId ?? null,
          billingMethod: input.billingMethod ?? 'TIME_AND_MATERIALS',
          currency: input.currency ?? customer?.currency ?? organization.baseCurrency,
          startsOn: input.startsOn ? isoDate(input.startsOn) : null,
          endsOn: input.endsOn ? isoDate(input.endsOn) : null,
          budgetAmountMinor: input.budgetAmountMinor ? BigInt(input.budgetAmountMinor) : null,
          budgetHours: input.budgetHours ?? null,
          defaultRateMinor: input.defaultRateMinor ? BigInt(input.defaultRateMinor) : null,
          description: input.description ?? null,
          createdByUserId: user.id,
        },
        include: projectInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.project_created',
        entityType: 'project',
        entityId: project.id,
        action: AuditAction.CREATE,
        after: { name: project.name, code: project.code, status: project.status },
        ipHash: metadata.ipHash,
      });
      return project;
    });

    return summarizeProject(created);
  }

  async update(
    context: OrganizationContext,
    user: PublicUser,
    projectId: string,
    input: UpdateProjectDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findProjectOrThrow(context.id, projectId);
    if (input.customerId) await this.resolveCustomer(context.id, input.customerId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id: projectId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.code === undefined ? {} : { code: input.code }),
          ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
          ...(input.managerUserId === undefined ? {} : { managerUserId: input.managerUserId }),
          ...(input.billingMethod === undefined ? {} : { billingMethod: input.billingMethod }),
          ...(input.startsOn === undefined ? {} : { startsOn: isoDate(input.startsOn) }),
          ...(input.endsOn === undefined ? {} : { endsOn: isoDate(input.endsOn) }),
          ...(input.budgetAmountMinor === undefined
            ? {}
            : { budgetAmountMinor: BigInt(input.budgetAmountMinor) }),
          ...(input.budgetHours === undefined ? {} : { budgetHours: input.budgetHours }),
          ...(input.defaultRateMinor === undefined
            ? {}
            : { defaultRateMinor: BigInt(input.defaultRateMinor) }),
          ...(input.description === undefined ? {} : { description: input.description }),
        },
        include: projectInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.project_updated',
        entityType: 'project',
        entityId: projectId,
        action: AuditAction.UPDATE,
        before: { name: existing.name, billingMethod: existing.billingMethod },
        after: { name: project.name, billingMethod: project.billingMethod },
        ipHash: metadata.ipHash,
      });
      return project;
    });

    return summarizeProject(updated);
  }

  /**
   * Open -> On Hold -> Completed -> Cancelled, with reopening allowed from any closed state.
   *
   * Completing a project does not settle anything: unbilled time and expenses stay invoiceable,
   * because discovering unbilled work after a project closes is normal and losing the ability to
   * bill it would be the product destroying revenue on the organization's behalf.
   */
  async changeStatus(
    context: OrganizationContext,
    user: PublicUser,
    projectId: string,
    input: ChangeProjectStatusDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findProjectOrThrow(context.id, projectId);
    if (existing.status === input.status) {
      throw new ConflictException(`This project is already ${input.status.toLowerCase()}.`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id: projectId },
        data: {
          status: input.status,
          completedAt: input.status === 'COMPLETED' ? new Date() : null,
        },
        include: projectInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.project_status_changed',
        entityType: 'project',
        entityId: projectId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status: project.status, reason: input.reason ?? null },
        ipHash: metadata.ipHash,
      });
      return project;
    });

    return summarizeProject(updated);
  }

  // --- tasks ------------------------------------------------------------------------------------

  async listTasks(organizationId: string, projectId: string) {
    await this.findProjectOrThrow(organizationId, projectId);
    const tasks = await this.prisma.projectTask.findMany({
      where: { organizationId, projectId },
      include: taskInclude,
      orderBy: [{ createdAt: 'asc' }],
      take: 500,
    });
    return tasks.map(summarizeTask);
  }

  async createTask(
    context: OrganizationContext,
    user: PublicUser,
    projectId: string,
    input: CreateProjectTaskDto,
    metadata: RequestMetadata,
  ) {
    const project = await this.findProjectOrThrow(context.id, projectId);
    this.assertProjectOpen(project.status, 'add tasks to');

    const created = await this.prisma.$transaction(async (tx) => {
      const task = await tx.projectTask.create({
        data: {
          organizationId: context.id,
          projectId,
          name: input.name,
          assigneeUserId: input.assigneeUserId ?? null,
          status: input.status ?? 'OPEN',
          estimateHours: input.estimateHours ?? null,
          billableDefault: input.billableDefault ?? true,
          rateMinor: input.rateMinor ? BigInt(input.rateMinor) : null,
        },
        include: taskInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.task_created',
        entityType: 'project_task',
        entityId: task.id,
        action: AuditAction.CREATE,
        after: { projectId, name: task.name },
        ipHash: metadata.ipHash,
      });
      return task;
    });

    return summarizeTask(created);
  }

  async updateTask(
    context: OrganizationContext,
    user: PublicUser,
    taskId: string,
    input: UpdateProjectTaskDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.projectTask.findFirst({
      where: { id: taskId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Task not found.');

    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.projectTask.update({
        where: { id: taskId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.assigneeUserId === undefined ? {} : { assigneeUserId: input.assigneeUserId }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.estimateHours === undefined ? {} : { estimateHours: input.estimateHours }),
          ...(input.billableDefault === undefined
            ? {}
            : { billableDefault: input.billableDefault }),
          ...(input.rateMinor === undefined ? {} : { rateMinor: BigInt(input.rateMinor) }),
        },
        include: taskInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.task_updated',
        entityType: 'project_task',
        entityId: taskId,
        action: AuditAction.UPDATE,
        before: { name: existing.name, status: existing.status },
        after: { name: task.name, status: task.status },
        ipHash: metadata.ipHash,
      });
      return task;
    });

    return summarizeTask(updated);
  }

  // --- budgets ----------------------------------------------------------------------------------

  async listBudgets(organizationId: string, projectId: string) {
    await this.findProjectOrThrow(organizationId, projectId);
    const budgets = await this.prisma.projectBudget.findMany({
      where: { organizationId, projectId },
      include: { task: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }],
      take: 500,
    });
    return budgets.map(summarizeBudget);
  }

  async upsertBudget(
    context: OrganizationContext,
    user: PublicUser,
    projectId: string,
    input: UpsertProjectBudgetDto,
    metadata: RequestMetadata,
  ) {
    await this.findProjectOrThrow(context.id, projectId);
    const task = await this.prisma.projectTask.findFirst({
      where: { id: input.taskId, organizationId: context.id, projectId },
    });
    if (!task) throw new NotFoundException('Task not found on this project.');

    const saved = await this.prisma.$transaction(async (tx) => {
      const budget = await tx.projectBudget.upsert({
        where: { projectId_taskId: { projectId, taskId: input.taskId } },
        create: {
          organizationId: context.id,
          projectId,
          taskId: input.taskId,
          budgetHours: input.budgetHours ?? null,
          budgetAmountMinor: input.budgetAmountMinor ? BigInt(input.budgetAmountMinor) : null,
          note: input.note ?? null,
        },
        update: {
          budgetHours: input.budgetHours ?? null,
          budgetAmountMinor: input.budgetAmountMinor ? BigInt(input.budgetAmountMinor) : null,
          note: input.note ?? null,
        },
        include: { task: { select: { name: true } } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.budget_set',
        entityType: 'project_budget',
        entityId: budget.id,
        action: AuditAction.UPDATE,
        after: {
          projectId,
          taskId: budget.taskId,
          budgetAmountMinor: budget.budgetAmountMinor?.toString() ?? null,
        },
        ipHash: metadata.ipHash,
      });
      return budget;
    });

    return summarizeBudget(saved);
  }

  // --- time -------------------------------------------------------------------------------------

  async listTimeEntries(
    organizationId: string,
    filter: { projectId?: string; userId?: string; status?: string; from?: string; to?: string },
  ) {
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        organizationId,
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
        ...(filter.from || filter.to
          ? {
              entryDate: {
                ...(filter.from ? { gte: isoDate(filter.from) } : {}),
                ...(filter.to ? { lte: isoDate(filter.to) } : {}),
              },
            }
          : {}),
      },
      include: timeEntryInclude,
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return entries.map(summarizeTimeEntry);
  }

  async createTimeEntry(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateTimeEntryDto,
    metadata: RequestMetadata,
  ) {
    const project = await this.findProjectOrThrow(context.id, input.projectId);
    this.assertProjectOpen(project.status, 'record time against');
    const task = await this.resolveTask(context.id, input.projectId, input.taskId);
    assertPositiveHours(input.hours);

    const created = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.create({
        data: {
          organizationId: context.id,
          projectId: input.projectId,
          taskId: task?.id ?? null,
          userId: input.userId ?? user.id,
          entryDate: isoDate(input.entryDate),
          hours: input.hours,
          billable: input.billable ?? task?.billableDefault ?? true,
          rateMinor: this.resolveRate(input.rateMinor, task, project),
          costRateMinor: input.costRateMinor ? BigInt(input.costRateMinor) : null,
          note: input.note ?? null,
        },
        include: timeEntryInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.time_recorded',
        entityType: 'time_entry',
        entityId: entry.id,
        action: AuditAction.CREATE,
        after: { projectId: entry.projectId, hours: entry.hours.toString() },
        ipHash: metadata.ipHash,
      });
      return entry;
    });

    return summarizeTimeEntry(created);
  }

  async updateTimeEntry(
    context: OrganizationContext,
    user: PublicUser,
    timeEntryId: string,
    input: UpdateTimeEntryDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findTimeEntryOrThrow(context.id, timeEntryId);
    this.assertTimeEditable(existing.status);
    if (input.hours !== undefined) assertPositiveHours(input.hours);
    const task = await this.resolveTask(context.id, existing.projectId, input.taskId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.timeEntry.update({
        where: { id: timeEntryId },
        data: {
          ...(input.taskId === undefined ? {} : { taskId: task?.id ?? null }),
          ...(input.entryDate === undefined ? {} : { entryDate: isoDate(input.entryDate) }),
          ...(input.hours === undefined ? {} : { hours: input.hours }),
          ...(input.billable === undefined ? {} : { billable: input.billable }),
          ...(input.rateMinor === undefined ? {} : { rateMinor: BigInt(input.rateMinor) }),
          ...(input.costRateMinor === undefined
            ? {}
            : { costRateMinor: BigInt(input.costRateMinor) }),
          ...(input.note === undefined ? {} : { note: input.note }),
          // A rejected entry that is edited returns to draft, so the approver sees a fresh
          // submission rather than silently re-approving something that changed underneath them.
          ...(existing.status === TimeEntryStatus.REJECTED
            ? { status: TimeEntryStatus.DRAFT, decisionComment: null }
            : {}),
        },
        include: timeEntryInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.time_updated',
        entityType: 'time_entry',
        entityId: timeEntryId,
        action: AuditAction.UPDATE,
        before: { hours: existing.hours.toString(), status: existing.status },
        after: { hours: entry.hours.toString(), status: entry.status },
        ipHash: metadata.ipHash,
      });
      return entry;
    });

    return summarizeTimeEntry(updated);
  }

  async deleteTimeEntry(context: OrganizationContext, user: PublicUser, timeEntryId: string) {
    const existing = await this.findTimeEntryOrThrow(context.id, timeEntryId);
    this.assertTimeEditable(existing.status);
    await this.prisma.timeEntry.delete({ where: { id: timeEntryId } });
    void user;
  }

  /** DRAFT|REJECTED -> SUBMITTED. From here the entry is immutable until someone acts on it. */
  async submitTime(
    context: OrganizationContext,
    user: PublicUser,
    input: TimeDecisionDto,
    metadata: RequestMetadata,
  ) {
    return this.transitionTime(context, user, input, metadata, {
      from: [TimeEntryStatus.DRAFT, TimeEntryStatus.REJECTED],
      to: TimeEntryStatus.SUBMITTED,
      eventKey: 'projects.time_submitted',
      data: () => ({ submittedAt: new Date(), decisionComment: null }),
      rejectionMessage: 'Only draft or rejected time can be submitted.',
    });
  }

  async approveTime(
    context: OrganizationContext,
    user: PublicUser,
    input: TimeDecisionDto,
    metadata: RequestMetadata,
  ) {
    return this.transitionTime(context, user, input, metadata, {
      from: [TimeEntryStatus.SUBMITTED],
      to: TimeEntryStatus.APPROVED,
      eventKey: 'projects.time_approved',
      data: (comment) => ({
        approvedByUserId: user.id,
        approvedAt: new Date(),
        decisionComment: comment ?? null,
      }),
      rejectionMessage: 'Only submitted time can be approved.',
    });
  }

  async rejectTime(
    context: OrganizationContext,
    user: PublicUser,
    input: TimeDecisionDto,
    metadata: RequestMetadata,
  ) {
    return this.transitionTime(context, user, input, metadata, {
      from: [TimeEntryStatus.SUBMITTED],
      to: TimeEntryStatus.REJECTED,
      eventKey: 'projects.time_rejected',
      data: (comment) => ({
        approvedByUserId: user.id,
        approvedAt: new Date(),
        decisionComment: comment ?? null,
      }),
      rejectionMessage: 'Only submitted time can be rejected.',
    });
  }

  /**
   * APPROVED -> DRAFT, the deliberate escape hatch from the immutability rule.
   *
   * Invoiced time is not unlockable: the hours are on a document the customer has, so correcting
   * them is a credit note, not an edit.
   */
  async unlockTime(
    context: OrganizationContext,
    user: PublicUser,
    input: TimeDecisionDto,
    metadata: RequestMetadata,
  ) {
    return this.transitionTime(context, user, input, metadata, {
      from: [TimeEntryStatus.APPROVED],
      to: TimeEntryStatus.DRAFT,
      eventKey: 'projects.time_unlocked',
      data: (comment) => ({
        approvedByUserId: null,
        approvedAt: null,
        submittedAt: null,
        decisionComment: comment ?? null,
      }),
      rejectionMessage: 'Only approved time can be unlocked. Invoiced time needs a credit note.',
    });
  }

  private async transitionTime(
    context: OrganizationContext,
    user: PublicUser,
    input: TimeDecisionDto,
    metadata: RequestMetadata,
    spec: {
      from: readonly TimeEntryStatus[];
      to: TimeEntryStatus;
      eventKey: string;
      data: (comment?: string) => Prisma.TimeEntryUpdateInput;
      rejectionMessage: string;
    },
  ) {
    const entries = await this.prisma.timeEntry.findMany({
      where: { id: { in: input.timeEntryIds }, organizationId: context.id },
      select: { id: true, status: true },
    });
    if (entries.length !== input.timeEntryIds.length) {
      throw new NotFoundException('One or more time entries were not found.');
    }
    const blocked = entries.filter((entry) => !spec.from.includes(entry.status));
    if (blocked.length > 0) throw new ConflictException(spec.rejectionMessage);

    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        await tx.timeEntry.update({
          where: { id: entry.id },
          data: { status: spec.to, ...spec.data(input.comment) },
        });
        await writeAuditEvent(tx, {
          organizationId: context.id,
          actorUserId: user.id,
          eventKey: spec.eventKey,
          entityType: 'time_entry',
          entityId: entry.id,
          action: AuditAction.UPDATE,
          before: { status: entry.status },
          after: { status: spec.to, comment: input.comment ?? null },
          ipHash: metadata.ipHash,
        });
      }
    });

    return this.listTimeEntries(context.id, {}).then((all) =>
      all.filter((entry) => input.timeEntryIds.includes(entry.id)),
    );
  }

  // --- project expenses -------------------------------------------------------------------------

  async listProjectExpenses(organizationId: string, projectId: string) {
    await this.findProjectOrThrow(organizationId, projectId);
    const rows = await this.prisma.projectExpense.findMany({
      where: { organizationId, projectId },
      include: projectExpenseInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    return rows.map(summarizeProjectExpense);
  }

  async linkExpense(
    context: OrganizationContext,
    user: PublicUser,
    projectId: string,
    input: LinkProjectExpenseDto,
    metadata: RequestMetadata,
  ) {
    await this.findProjectOrThrow(context.id, projectId);
    const expense = await this.prisma.expense.findFirst({
      where: { id: input.expenseId, organizationId: context.id },
      include: { projectExpense: true },
    });
    if (!expense) throw new NotFoundException('Expense not found.');
    if (expense.projectExpense) {
      throw new ConflictException('This expense is already attached to a project.');
    }
    if (expense.status !== 'POSTED') {
      throw new ConflictException('Only a posted expense can be attached to a project.');
    }
    // The expense's own `projectId` is the cost attribution, frozen onto its journal line when it
    // posted. This link decides re-billing, and the two must name the same project: letting them
    // diverge would bill one project for another's cost, and no later edit can move the posted
    // line to agree.
    if (expense.projectId && expense.projectId !== projectId) {
      throw new ConflictException(
        'This expense posted its cost to a different project. Attach it there, or record a new expense against this one.',
      );
    }
    if (!expense.projectId) {
      throw new ConflictException(
        'This expense posted without a project, so its cost is not attributed to one. Set the project before posting an expense you intend to rebill.',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectExpense.create({
        data: {
          organizationId: context.id,
          projectId,
          expenseId: expense.id,
          billable: input.billable ?? true,
          markupPercent: input.markupPercent ?? null,
        },
        include: projectExpenseInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.expense_linked',
        entityType: 'project_expense',
        entityId: row.id,
        action: AuditAction.CREATE,
        after: { projectId, expenseId: expense.id, billable: row.billable },
        ipHash: metadata.ipHash,
      });
      return row;
    });

    return summarizeProjectExpense(created);
  }

  async updateProjectExpense(
    context: OrganizationContext,
    user: PublicUser,
    projectExpenseId: string,
    input: UpdateProjectExpenseDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.projectExpense.findFirst({
      where: { id: projectExpenseId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Project expense not found.');
    if (existing.invoiceLineId) {
      throw new ConflictException('This expense has already been invoiced and cannot be changed.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectExpense.update({
        where: { id: projectExpenseId },
        data: {
          ...(input.billable === undefined ? {} : { billable: input.billable }),
          ...(input.markupPercent === undefined ? {} : { markupPercent: input.markupPercent }),
        },
        include: projectExpenseInclude,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.expense_updated',
        entityType: 'project_expense',
        entityId: projectExpenseId,
        action: AuditAction.UPDATE,
        before: { billable: existing.billable },
        after: { billable: row.billable },
        ipHash: metadata.ipHash,
      });
      return row;
    });

    return summarizeProjectExpense(updated);
  }

  async unlinkExpense(context: OrganizationContext, user: PublicUser, projectExpenseId: string) {
    const existing = await this.prisma.projectExpense.findFirst({
      where: { id: projectExpenseId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Project expense not found.');
    if (existing.invoiceLineId) {
      throw new ConflictException('This expense has already been invoiced and cannot be detached.');
    }
    await this.prisma.projectExpense.delete({ where: { id: projectExpenseId } });
    void user;
  }

  // --- billing ----------------------------------------------------------------------------------

  /** What `generateInvoice` would bill right now, so the flow can be previewed before it commits. */
  async listBillables(organizationId: string, projectId: string) {
    const project = await this.findProjectOrThrow(organizationId, projectId);
    const { timeEntries, projectExpenses } = await this.loadBillables(organizationId, projectId);
    return [
      ...timeEntries.map((entry) => timeBillable(entry, project)),
      ...projectExpenses.map(expenseBillable),
    ];
  }

  /**
   * Turns approved unbilled time and billable expenses into a real invoice.
   *
   * It does not fork the invoice path: lines are handed to `InvoicesService.createDraft` and, when
   * asked to issue, to `issueInvoice`, so this inherits the existing tax resolution, numbering,
   * posting rule, and audit trail rather than reimplementing them alongside.
   *
   * The invoiced-once guard is a conditional update -- `WHERE invoice_line_id IS NULL` -- whose
   * affected-row count is checked. Two concurrent calls cannot both claim the same entry: the
   * second matches zero rows and the whole transaction rolls back, taking its invoice with it.
   * That last clause is only true because the draft is created *inside* this transaction, via
   * `createDraft`'s `externalTx`. Created outside it, a losing race would leave a stray draft
   * invoice standing for work that is still unbilled.
   */
  async generateInvoice(
    context: OrganizationContext,
    user: PublicUser,
    projectId: string,
    input: GenerateProjectInvoiceDto,
    metadata: RequestMetadata,
    idempotencyKey?: string,
  ) {
    const project = await this.findProjectOrThrow(context.id, projectId);
    if (project.billingMethod === 'NON_BILLABLE') {
      throw new ConflictException('A non-billable project cannot be invoiced.');
    }
    const customerId = project.customerId;
    if (!customerId) {
      throw new BadRequestException('Attach a customer to this project before invoicing it.');
    }

    const existing = await this.findInvoiceIdempotentResult(context.id, idempotencyKey);
    if (existing) return this.invoices.detail(context.id, existing.resourceId);

    const { timeEntries, projectExpenses } = await this.loadBillables(context.id, projectId, input);
    if (timeEntries.length === 0 && projectExpenses.length === 0) {
      throw new BadRequestException('There is nothing approved and unbilled to invoice.');
    }

    const billables = [
      ...timeEntries.map((entry) => ({
        kind: 'TIME' as const,
        id: entry.id,
        line: timeBillable(entry, project),
      })),
      ...projectExpenses.map((row) => ({
        kind: 'EXPENSE' as const,
        id: row.id,
        line: expenseBillable(row),
      })),
    ];

    const draft = await this.prisma.$transaction(async (tx) => {
      const invoice = await this.invoices.createDraft(
        context,
        user,
        {
          contactId: customerId,
          currency: project.currency,
          dueDate: input.dueDate,
          lines: billables.map((billable) => ({
            description: billable.line.description,
            quantity: billable.line.quantity,
            unitPriceMinor: billable.line.unitPriceMinor,
            projectId,
          })),
        },
        metadata,
        tx,
      );

      // Claim the sources against the lines they produced. Line order matches `billables` because
      // `createDraft` writes lines in the order it is given them and numbers them from one.
      const orderedLines = [...invoice.lines].sort((a, b) => a.lineNumber - b.lineNumber);
      for (const [index, billable] of billables.entries()) {
        const line = orderedLines[index];
        if (!line) throw new BadRequestException('Invoice lines did not match the billable list.');
        const claimed =
          billable.kind === 'TIME'
            ? await tx.timeEntry.updateMany({
                where: { id: billable.id, organizationId: context.id, invoiceLineId: null },
                data: { invoiceLineId: line.id, status: TimeEntryStatus.INVOICED },
              })
            : await tx.projectExpense.updateMany({
                where: { id: billable.id, organizationId: context.id, invoiceLineId: null },
                data: { invoiceLineId: line.id },
              });
        if (claimed.count !== 1) {
          throw new ConflictException(
            'Some of this work was invoiced by another request. Nothing was billed twice.',
          );
        }
      }

      await this.recordInvoiceIdempotency(tx, context.id, idempotencyKey, invoice.id);
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'projects.invoice_generated',
        entityType: 'project',
        entityId: projectId,
        action: AuditAction.UPDATE,
        after: {
          invoiceId: invoice.id,
          timeEntryCount: timeEntries.length,
          expenseCount: projectExpenses.length,
        },
        ipHash: metadata.ipHash,
      });

      return invoice;
    });

    if (input.issue === false) return this.invoices.detail(context.id, draft.id);
    return this.invoices.issueInvoice(context, user, draft.id, metadata);
  }

  // --- profitability ----------------------------------------------------------------------------

  /**
   * Revenue and cost come from posted journal lines carrying this project's dimension, not from a
   * parallel sum over invoices and expenses. That is decision D1's whole point: the figure here and
   * the figure in the P&L are the same query against the same rows, so they cannot disagree.
   */
  async profitability(organizationId: string, projectId: string) {
    const project = await this.findProjectOrThrow(organizationId, projectId);

    const [ledger, timeRows, expenseRows] = await Promise.all([
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          organizationId,
          projectId,
          journal: { organizationId, status: { in: ['POSTED', 'REVERSED'] } },
        },
        _sum: { debitMinor: true, creditMinor: true },
      }),
      this.prisma.timeEntry.findMany({
        where: { organizationId, projectId },
        select: { hours: true, billable: true, rateMinor: true, status: true, invoiceLineId: true },
      }),
      this.prisma.projectExpense.findMany({
        where: { organizationId, projectId, invoiceLineId: null, billable: true },
        include: { expense: { select: { totalMinor: true } } },
      }),
    ]);

    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { organizationId, id: { in: ledger.map((row) => row.accountId) } },
      select: { id: true, type: true },
    });
    const accountType = new Map(accounts.map((account) => [account.id, account.type]));

    let revenueMinor = 0n;
    let costMinor = 0n;
    for (const row of ledger) {
      const debit = row._sum.debitMinor ?? 0n;
      const credit = row._sum.creditMinor ?? 0n;
      const type = accountType.get(row.accountId);
      if (type === 'REVENUE') revenueMinor += credit - debit;
      if (type === 'EXPENSE') costMinor += debit - credit;
    }

    let billedHours = 0n;
    let unbilledHours = 0n;
    let unbilledTimeMinor = 0n;
    for (const entry of timeRows) {
      const hours = scaledHours(entry.hours);
      if (entry.invoiceLineId) {
        billedHours += hours;
        continue;
      }
      if (!entry.billable) continue;
      unbilledHours += hours;
      if (entry.status === TimeEntryStatus.APPROVED) {
        unbilledTimeMinor +=
          (hours * (entry.rateMinor ?? project.defaultRateMinor ?? 0n)) / HOURS_SCALE;
      }
    }

    const unbilledExpenseMinor = expenseRows.reduce(
      (total, row) => total + withMarkup(row.expense.totalMinor, row.markupPercent),
      0n,
    );
    const marginMinor = revenueMinor - costMinor;

    return {
      projectId: project.id,
      projectName: project.name,
      currency: project.currency,
      revenueMinor: revenueMinor.toString(),
      costMinor: costMinor.toString(),
      marginMinor: marginMinor.toString(),
      marginPercent:
        revenueMinor === 0n ? null : ((marginMinor * 10000n) / revenueMinor / 100n).toString(),
      billedHours: unscaleHours(billedHours),
      unbilledHours: unscaleHours(unbilledHours),
      unbilledTimeMinor: unbilledTimeMinor.toString(),
      unbilledExpenseMinor: unbilledExpenseMinor.toString(),
      budgetAmountMinor: project.budgetAmountMinor?.toString() ?? null,
      budgetHours: project.budgetHours?.toString() ?? null,
    };
  }

  // --- helpers ----------------------------------------------------------------------------------

  private async loadBillables(
    organizationId: string,
    projectId: string,
    input?: GenerateProjectInvoiceDto,
  ) {
    const [timeEntries, projectExpenses] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: {
          organizationId,
          projectId,
          billable: true,
          status: TimeEntryStatus.APPROVED,
          invoiceLineId: null,
          ...(input?.timeEntryIds?.length ? { id: { in: input.timeEntryIds } } : {}),
        },
        include: timeEntryInclude,
        orderBy: [{ entryDate: 'asc' }],
      }),
      this.prisma.projectExpense.findMany({
        where: {
          organizationId,
          projectId,
          billable: true,
          invoiceLineId: null,
          ...(input?.projectExpenseIds?.length ? { id: { in: input.projectExpenseIds } } : {}),
        },
        include: projectExpenseInclude,
        orderBy: [{ createdAt: 'asc' }],
      }),
    ]);
    return { timeEntries, projectExpenses };
  }

  private async findProjectOrThrow(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      include: projectInclude,
    });
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }

  private async findTimeEntryOrThrow(organizationId: string, timeEntryId: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: timeEntryId, organizationId },
    });
    if (!entry) throw new NotFoundException('Time entry not found.');
    return entry;
  }

  private async resolveCustomer(organizationId: string, customerId?: string) {
    if (!customerId) return null;
    const customer = await this.prisma.contact.findFirst({
      where: { id: customerId, organizationId, type: 'CUSTOMER' },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    return customer;
  }

  private async resolveTask(organizationId: string, projectId: string, taskId?: string) {
    if (!taskId) return null;
    const task = await this.prisma.projectTask.findFirst({
      where: { id: taskId, organizationId, projectId },
    });
    if (!task) throw new NotFoundException('Task not found on this project.');
    return task;
  }

  private resolveRate(
    explicit: string | undefined,
    task: { rateMinor: bigint | null } | null,
    project: { defaultRateMinor: bigint | null },
  ): bigint | null {
    if (explicit !== undefined) return BigInt(explicit);
    return task?.rateMinor ?? project.defaultRateMinor ?? null;
  }

  private assertProjectOpen(status: string, action: string): void {
    if ((CLOSED_PROJECT_STATUSES as readonly string[]).includes(status)) {
      throw new ConflictException(`Cannot ${action} a ${status.toLowerCase()} project.`);
    }
  }

  /**
   * Each locked state names the one door out of itself. A single shared message cannot: telling
   * the holder of an approved entry to reject it points them at a transition that only accepts
   * submitted time, and they would bounce off it.
   */
  private assertTimeEditable(status: TimeEntryStatus): void {
    if (!LOCKED_TIME_STATUSES.includes(status)) return;
    if (status === TimeEntryStatus.INVOICED) {
      throw new ConflictException('Invoiced time cannot be changed. Raise a credit note instead.');
    }
    throw new ConflictException(
      status === TimeEntryStatus.APPROVED
        ? 'Approved time is locked. Unlock it before editing.'
        : 'Submitted time is locked. Reject it before editing.',
    );
  }

  private findInvoiceIdempotentResult(organizationId: string, key?: string) {
    if (!key) return Promise.resolve(null);
    return this.prisma.ledgerIdempotencyKey.findUnique({
      where: {
        organizationId_operation_key: {
          organizationId,
          operation: 'PROJECT_GENERATE_INVOICE',
          key,
        },
      },
      select: { resourceId: true },
    });
  }

  private recordInvoiceIdempotency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key: string | undefined,
    invoiceId: string,
  ) {
    if (!key) return undefined;
    return tx.ledgerIdempotencyKey.create({
      data: {
        organizationId,
        operation: 'PROJECT_GENERATE_INVOICE',
        key,
        resourceType: 'INVOICE',
        resourceId: invoiceId,
      },
    });
  }
}

const projectInclude = {
  customer: { select: { displayName: true } },
  manager: { select: { displayName: true } },
} satisfies Prisma.ProjectInclude;

const taskInclude = {
  assignee: { select: { displayName: true } },
} satisfies Prisma.ProjectTaskInclude;

const timeEntryInclude = {
  project: { select: { name: true, defaultRateMinor: true } },
  task: { select: { name: true } },
  user: { select: { displayName: true } },
  approvedBy: { select: { displayName: true } },
} satisfies Prisma.TimeEntryInclude;

const projectExpenseInclude = {
  expense: {
    select: {
      expenseNumber: true,
      expenseDate: true,
      payeeName: true,
      totalMinor: true,
      payeeVendor: { select: { displayName: true } },
    },
  },
} satisfies Prisma.ProjectExpenseInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;
type TaskRow = Prisma.ProjectTaskGetPayload<{ include: typeof taskInclude }>;
type TimeEntryRow = Prisma.TimeEntryGetPayload<{ include: typeof timeEntryInclude }>;
type ProjectExpenseRow = Prisma.ProjectExpenseGetPayload<{
  include: typeof projectExpenseInclude;
}>;
type BudgetRow = Prisma.ProjectBudgetGetPayload<{ include: { task: { select: { name: true } } } }>;

function summarizeProject(project: ProjectRow) {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    customerId: project.customerId,
    customerName: project.customer?.displayName ?? null,
    managerUserId: project.managerUserId,
    managerName: project.manager?.displayName ?? null,
    status: project.status,
    billingMethod: project.billingMethod,
    currency: project.currency,
    startsOn: project.startsOn ? dateOnly(project.startsOn) : null,
    endsOn: project.endsOn ? dateOnly(project.endsOn) : null,
    budgetAmountMinor: project.budgetAmountMinor?.toString() ?? null,
    budgetHours: project.budgetHours?.toString() ?? null,
    defaultRateMinor: project.defaultRateMinor?.toString() ?? null,
    description: project.description,
    completedAt: project.completedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function summarizeTask(task: TaskRow) {
  return {
    id: task.id,
    projectId: task.projectId,
    name: task.name,
    assigneeUserId: task.assigneeUserId,
    assigneeName: task.assignee?.displayName ?? null,
    status: task.status,
    estimateHours: task.estimateHours?.toString() ?? null,
    billableDefault: task.billableDefault,
    rateMinor: task.rateMinor?.toString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function summarizeTimeEntry(entry: TimeEntryRow) {
  const rate = entry.rateMinor ?? entry.project.defaultRateMinor ?? 0n;
  return {
    id: entry.id,
    projectId: entry.projectId,
    projectName: entry.project.name,
    taskId: entry.taskId,
    taskName: entry.task?.name ?? null,
    userId: entry.userId,
    userName: entry.user.displayName,
    entryDate: dateOnly(entry.entryDate),
    hours: entry.hours.toString(),
    billable: entry.billable,
    rateMinor: entry.rateMinor?.toString() ?? null,
    costRateMinor: entry.costRateMinor?.toString() ?? null,
    amountMinor: ((scaledHours(entry.hours) * rate) / HOURS_SCALE).toString(),
    note: entry.note,
    status: entry.status,
    submittedAt: entry.submittedAt?.toISOString() ?? null,
    approvedByName: entry.approvedBy?.displayName ?? null,
    approvedAt: entry.approvedAt?.toISOString() ?? null,
    decisionComment: entry.decisionComment,
    invoiceLineId: entry.invoiceLineId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function summarizeProjectExpense(row: ProjectExpenseRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    expenseId: row.expenseId,
    expenseNumber: row.expense.expenseNumber,
    expenseDate: dateOnly(row.expense.expenseDate),
    payeeName: row.expense.payeeVendor?.displayName ?? row.expense.payeeName,
    amountMinor: row.expense.totalMinor.toString(),
    billable: row.billable,
    markupPercent: row.markupPercent?.toString() ?? null,
    billableAmountMinor: withMarkup(row.expense.totalMinor, row.markupPercent).toString(),
    invoiceLineId: row.invoiceLineId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function summarizeBudget(budget: BudgetRow) {
  return {
    id: budget.id,
    projectId: budget.projectId,
    taskId: budget.taskId,
    taskName: budget.task?.name ?? null,
    budgetHours: budget.budgetHours?.toString() ?? null,
    budgetAmountMinor: budget.budgetAmountMinor?.toString() ?? null,
    note: budget.note,
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}

function timeBillable(entry: TimeEntryRow, project: { defaultRateMinor: bigint | null }) {
  const rate = entry.rateMinor ?? project.defaultRateMinor ?? 0n;
  return {
    sourceType: 'TIME' as const,
    sourceId: entry.id,
    description: `${entry.project.name}${entry.task ? ` — ${entry.task.name}` : ''} (${dateOnly(entry.entryDate)})`,
    quantity: entry.hours.toString(),
    unitPriceMinor: rate.toString(),
    lineTotalMinor: ((scaledHours(entry.hours) * rate) / HOURS_SCALE).toString(),
  };
}

function expenseBillable(row: ProjectExpenseRow) {
  const amount = withMarkup(row.expense.totalMinor, row.markupPercent);
  return {
    sourceType: 'EXPENSE' as const,
    sourceId: row.id,
    description: `Expense ${row.expense.expenseNumber ?? dateOnly(row.expense.expenseDate)}`,
    quantity: '1',
    unitPriceMinor: amount.toString(),
    lineTotalMinor: amount.toString(),
  };
}

/**
 * Applies a re-billing markup in integer arithmetic. `markupPercent` is a `Decimal(7,4)`, so it is
 * scaled by 10,000 and divided back out -- no float touches a money value, matching the ledger.
 */
function withMarkup(amountMinor: bigint, markupPercent: Prisma.Decimal | null): bigint {
  if (!markupPercent) return amountMinor;
  const scaled = BigInt(markupPercent.mul(10000).toFixed(0));
  return amountMinor + (amountMinor * scaled) / 1_000_000n;
}

/** Hours as an integer scaled by 100, so hour x rate stays exact integer arithmetic. */
function scaledHours(hours: Prisma.Decimal): bigint {
  return BigInt(hours.mul(Number(HOURS_SCALE)).toFixed(0));
}

function unscaleHours(scaled: bigint): string {
  const whole = scaled / HOURS_SCALE;
  const fraction = (scaled % HOURS_SCALE).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

function assertPositiveHours(hours: string): void {
  if (Number(hours) <= 0) throw new BadRequestException('Time must be greater than zero hours.');
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
