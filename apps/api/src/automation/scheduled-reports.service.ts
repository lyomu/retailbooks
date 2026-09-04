import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ScheduledJobMisfirePolicy, ScheduledJobStatus } from '@prisma/client';
import { createScheduledReportSchema } from '@retailbooks/contracts';
import { randomUUID } from 'node:crypto';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { OrganizationAccessService } from '../organizations/organization-access.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type {
  CreateScheduledReportDto,
  UpdateScheduledReportDto,
} from './scheduled-reports.dto.js';
import { nextOccurrence, type CalendarSchedule } from './scheduler.service.js';

@Injectable()
export class ScheduledReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
  ) {}

  async list(organizationId: string) {
    return this.prisma.scheduledReport.findMany({
      where: { organizationId },
      include: {
        savedReport: { select: { id: true, name: true, reportKey: true } },
        scheduledJob: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateScheduledReportDto,
    metadata: RequestMetadata,
  ) {
    const schedule = normalizeSchedule(input);
    const parsed = createScheduledReportSchema.safeParse({
      name: input.name,
      savedReportId: input.savedReportId,
      recipientUserIds: input.recipientUserIds,
      format: input.format,
      schedule,
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const saved = await this.prisma.savedReport.findFirst({
      where: { id: input.savedReportId, organizationId: context.id, createdByUserId: user.id },
      select: { id: true },
    });
    if (!saved) throw new NotFoundException('Saved report not found.');
    await this.assertRecipients(context.id, input.recipientUserIds);
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { timeZone: true },
    });
    const scheduledReportId = randomUUID();
    const scheduledJobId = randomUUID();
    const nextRunAt = nextOccurrence(new Date(), schedule, organization.timeZone);
    return this.prisma.$transaction(async (tx) => {
      await tx.scheduledJob.create({
        data: {
          id: scheduledJobId,
          organizationId: context.id,
          createdByUserId: user.id,
          handler: 'report.scheduled',
          sourceType: 'SCHEDULED_REPORT',
          sourceId: scheduledReportId,
          payload: { scheduledReportId },
          schedule,
          timeZone: organization.timeZone,
          misfirePolicy: ScheduledJobMisfirePolicy.RUN_ONCE,
          nextRunAt,
        },
      });
      const report = await tx.scheduledReport.create({
        data: {
          id: scheduledReportId,
          organizationId: context.id,
          savedReportId: saved.id,
          scheduledJobId,
          name: input.name,
          format: input.format,
          recipientUserIds: input.recipientUserIds,
        },
        include: {
          savedReport: { select: { id: true, name: true, reportKey: true } },
          scheduledJob: true,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.scheduled_report_created',
        entityType: 'scheduled_report',
        entityId: report.id,
        action: AuditAction.CREATE,
        after: {
          savedReportId: report.savedReportId,
          format: report.format,
          recipients: input.recipientUserIds.length,
        },
        ipHash: metadata.ipHash,
      });
      return report;
    });
  }

  /**
   * Edits name/recipients/format/schedule. `savedReportId` is intentionally not editable here --
   * pointing an existing schedule at a different report is materially a new schedule, not an edit
   * of this one. A schedule change resets `nextRunAt` from the current instant, the same "next
   * occurrence from now" calculation `create` uses, rather than trying to preserve a next-run time
   * computed under the old cadence.
   */
  async update(
    context: OrganizationContext,
    user: PublicUser,
    scheduledReportId: string,
    input: UpdateScheduledReportDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.scheduledReport.findFirst({
      where: { id: scheduledReportId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Scheduled report not found.');
    if (input.recipientUserIds) await this.assertRecipients(context.id, input.recipientUserIds);

    let schedule: CalendarSchedule | undefined;
    let nextRunAt: Date | undefined;
    if (input.schedule) {
      schedule = normalizeSchedule({ schedule: input.schedule });
      const organization = await this.prisma.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { timeZone: true },
      });
      nextRunAt = nextOccurrence(new Date(), schedule, organization.timeZone);
    }

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.scheduledReport.update({
        where: { id: scheduledReportId },
        data: {
          name: input.name,
          format: input.format,
          recipientUserIds: input.recipientUserIds,
        },
        include: {
          savedReport: { select: { id: true, name: true, reportKey: true } },
          scheduledJob: true,
        },
      });
      if (schedule) {
        await tx.scheduledJob.update({
          where: { id: existing.scheduledJobId },
          data: { schedule, nextRunAt },
        });
      }
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.scheduled_report_updated',
        entityType: 'scheduled_report',
        entityId: report.id,
        action: AuditAction.UPDATE,
        before: { name: existing.name, format: existing.format },
        after: { name: report.name, format: report.format },
        ipHash: metadata.ipHash,
      });
      return report;
    });
  }

  async setActive(
    context: OrganizationContext,
    user: PublicUser,
    scheduledReportId: string,
    active: boolean,
    metadata: RequestMetadata,
  ) {
    const report = await this.prisma.scheduledReport.findFirst({
      where: { id: scheduledReportId, organizationId: context.id },
      include: { scheduledJob: true },
    });
    if (!report) throw new NotFoundException('Scheduled report not found.');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.scheduledReport.update({
        where: { id: report.id },
        data: { active },
        include: {
          savedReport: { select: { id: true, name: true, reportKey: true } },
          scheduledJob: true,
        },
      });
      await tx.scheduledJob.update({
        where: { id: report.scheduledJobId },
        data: { status: active ? ScheduledJobStatus.ACTIVE : ScheduledJobStatus.PAUSED },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: active
          ? 'automation.scheduled_report_activated'
          : 'automation.scheduled_report_paused',
        entityType: 'scheduled_report',
        entityId: report.id,
        action: AuditAction.UPDATE,
        before: { active: report.active },
        after: { active },
        ipHash: metadata.ipHash,
      });
      return updated;
    });
  }

  private async assertRecipients(organizationId: string, userIds: string[]) {
    for (const userId of [...new Set(userIds)]) {
      const recipient = await this.organizationAccess.requireMembership(userId, organizationId);
      if (!recipient.permissions.has('reports.view')) {
        throw new BadRequestException(
          'Each scheduled report recipient must currently be able to view reports.',
        );
      }
    }
  }
}

function normalizeSchedule(input: {
  schedule: CreateScheduledReportDto['schedule'];
}): CalendarSchedule {
  const options = input.schedule.options ?? {};
  return {
    cadence: input.schedule.cadence,
    localTime: input.schedule.localTime,
    weekday: typeof options.weekday === 'number' ? options.weekday : undefined,
    dayOfMonth: typeof options.dayOfMonth === 'number' ? options.dayOfMonth : undefined,
    endDate: typeof options.endDate === 'string' ? options.endDate : undefined,
  };
}
