import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  ScheduledJobMisfirePolicy,
  ScheduledJobStatus,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { EmailQueueService } from '../jobs/email-queue.service.js';
import { EMAIL_JOB_NAMES } from '../jobs/email-job.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { SchedulerService } from './scheduler.service.js';
import type { CreateReminderPolicyDto, UpdateReminderPolicyDto } from './reminders.dto.js';

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly email: EmailQueueService,
  ) {}

  async list(organizationId: string) {
    return this.prisma.reminderPolicy.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateReminderPolicyDto,
    metadata: RequestMetadata,
  ) {
    const offsets = parseOffsets(input.offsets);
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.reminderPolicy.create({
        data: {
          organizationId: context.id,
          name: input.name.trim(),
          offsets,
          subject: input.subject.trim(),
          bodyTemplate: input.bodyTemplate,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.reminder_policy_created',
        entityType: 'reminder_policy',
        entityId: policy.id,
        action: AuditAction.CREATE,
        after: { offsets },
        ipHash: metadata.ipHash,
      });
      return policy;
    });
  }

  /**
   * Edits an existing policy's offsets/subject/template. Unlike `ApprovalPolicy`/`WorkflowRule`,
   * there is nothing here that freezes at another entity's submission time, so -- unlike those --
   * editing is not blocked while the policy is active; the next reminder to fire simply reads
   * whatever this update leaves behind.
   */
  async update(
    context: OrganizationContext,
    user: PublicUser,
    policyId: string,
    input: UpdateReminderPolicyDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.reminderPolicy.findFirst({
      where: { id: policyId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Reminder policy not found.');
    const offsets = input.offsets !== undefined ? parseOffsets(input.offsets) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.reminderPolicy.update({
        where: { id: policyId },
        data: {
          name: input.name?.trim(),
          offsets,
          subject: input.subject?.trim(),
          bodyTemplate: input.bodyTemplate,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.reminder_policy_updated',
        entityType: 'reminder_policy',
        entityId: policyId,
        action: AuditAction.UPDATE,
        before: { name: existing.name, offsets: existing.offsets },
        after: { name: policy.name, offsets: policy.offsets },
        ipHash: metadata.ipHash,
      });
      return policy;
    });
  }

  async setActive(
    context: OrganizationContext,
    user: PublicUser,
    policyId: string,
    active: boolean,
    metadata: RequestMetadata,
  ) {
    const policy = await this.prisma.reminderPolicy.findFirst({
      where: { id: policyId, organizationId: context.id },
    });
    if (!policy) throw new NotFoundException('Reminder policy not found.');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reminderPolicy.update({ where: { id: policyId }, data: { active } });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: active
          ? 'automation.reminder_policy_activated'
          : 'automation.reminder_policy_deactivated',
        entityType: 'reminder_policy',
        entityId: policyId,
        action: AuditAction.UPDATE,
        before: { active: policy.active },
        after: { active },
        ipHash: metadata.ipHash,
      });
      return updated;
    });
  }

  /** Called from invoice issue within the same transaction; no issued invoice can lose its reminders. */
  async scheduleInvoiceReminders(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      createdByUserId: string;
      invoiceId: string;
      dueDate: Date | null;
    },
  ) {
    if (!input.dueDate) return;
    const [policies, organization] = await Promise.all([
      tx.reminderPolicy.findMany({ where: { organizationId: input.organizationId, active: true } }),
      tx.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        select: { timeZone: true },
      }),
    ]);
    for (const policy of policies) {
      for (const offsetDays of parseOffsets(policy.offsets)) {
        const sourceId = randomUUID();
        await tx.scheduledJob.create({
          data: {
            organizationId: input.organizationId,
            createdByUserId: input.createdByUserId,
            handler: 'invoice.reminder',
            sourceType: `INVOICE_REMINDER:${input.invoiceId}`,
            sourceId,
            payload: { invoiceId: input.invoiceId, reminderPolicyId: policy.id, offsetDays },
            schedule: { cadence: 'DAILY', localTime: '09:00' },
            timeZone: organization.timeZone,
            misfirePolicy: ScheduledJobMisfirePolicy.RUN_ONCE,
            nextRunAt: addDays(input.dueDate, offsetDays),
          },
        });
      }
    }
  }

  async execute(executionId: string): Promise<void> {
    const execution = await this.scheduler.beginExecution(executionId);
    if (!execution) return;
    try {
      const payload = reminderPayload(execution.scheduledJob.payload);
      const [invoice, policy] = await Promise.all([
        this.prisma.invoice.findFirst({
          where: { id: payload.invoiceId, organizationId: execution.organizationId },
          include: { contact: { select: { displayName: true, email: true } } },
        }),
        this.prisma.reminderPolicy.findFirst({
          where: {
            id: payload.reminderPolicyId,
            organizationId: execution.organizationId,
            active: true,
          },
        }),
      ]);
      if (
        !invoice ||
        !policy ||
        !invoice.contact.email ||
        !['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)
      ) {
        await this.finish(executionId, execution.scheduledJob.id, {
          skipped: 'Invoice is no longer eligible for a reminder.',
        });
        return;
      }
      const values = {
        invoiceNumber: invoice.invoiceNumber ?? invoice.id,
        customerName: invoice.contact.displayName,
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? '',
        balanceMinor: invoice.balanceMinor.toString(),
      };
      await this.email.enqueue(EMAIL_JOB_NAMES.invoiceReminder, {
        to: invoice.contact.email,
        subject: template(policy.subject, values),
        text: template(policy.bodyTemplate, values),
        html: `<p>${escapeHtml(template(policy.bodyTemplate, values)).replaceAll('\n', '<br>')}</p>`,
      });
      await this.finish(executionId, execution.scheduledJob.id, {
        delivered: true,
        invoiceId: invoice.id,
      });
    } catch (error) {
      await this.scheduler.failExecution(executionId, error);
      throw error;
    }
  }

  private async finish(
    executionId: string,
    scheduledJobId: string,
    result: Prisma.InputJsonObject,
  ) {
    await this.scheduler.completeExecution(executionId, result);
    await this.prisma.scheduledJob.update({
      where: { id: scheduledJobId },
      data: { status: ScheduledJobStatus.COMPLETED, completedAt: new Date() },
    });
  }
}

function parseOffsets(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    !value.every((item) => Number.isInteger(item) && item >= -365 && item <= 365)
  ) {
    throw new BadRequestException('Reminder offsets must be whole days between -365 and 365.');
  }
  return [...new Set(value as number[])].sort((left, right) => left - right);
}

function reminderPayload(value: Prisma.JsonValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Reminder job payload is invalid.');
  const payload = value as Record<string, unknown>;
  if (typeof payload.invoiceId !== 'string' || typeof payload.reminderPolicyId !== 'string')
    throw new Error('Reminder job payload is incomplete.');
  return { invoiceId: payload.invoiceId, reminderPolicyId: payload.reminderPolicyId };
}

function addDays(date: Date, offset: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
}

function template(value: string, values: Record<string, string>) {
  return value.replaceAll(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key: string) => values[key] ?? '');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
