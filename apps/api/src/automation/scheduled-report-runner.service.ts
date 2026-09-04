import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { REPORT_KEYS, type ReportKey } from '@retailbooks/contracts';
import { UserStatus } from '@prisma/client';

import { EmailQueueService } from '../jobs/email-queue.service.js';
import { EMAIL_JOB_NAMES } from '../jobs/email-job.js';
import { ReportArtifactService } from '../reporting/report-artifact.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { OrganizationAccessService } from '../organizations/organization-access.service.js';
import { SchedulerService } from './scheduler.service.js';

@Injectable()
export class ScheduledReportRunnerService {
  private readonly logger = new Logger(ScheduledReportRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly access: OrganizationAccessService,
    private readonly artifacts: ReportArtifactService,
    private readonly storage: StorageService,
    private readonly email: EmailQueueService,
  ) {}

  async execute(executionId: string): Promise<void> {
    const execution = await this.scheduler.beginExecution(executionId);
    if (!execution) return;
    try {
      if (execution.scheduledJob.handler !== 'report.scheduled') {
        throw new Error(
          `Scheduled report runner cannot process ${execution.scheduledJob.handler}.`,
        );
      }
      const scheduledReportId = readScheduledReportId(execution.scheduledJob.payload);
      const scheduled = await this.prisma.scheduledReport.findFirst({
        where: { id: scheduledReportId, organizationId: execution.organizationId, active: true },
        include: { savedReport: true },
      });
      if (!scheduled) throw new NotFoundException('Scheduled report is no longer active.');
      if (!REPORT_KEYS.includes(scheduled.savedReport.reportKey as ReportKey))
        throw new Error('Saved report has an unknown definition.');
      const recipients = readRecipients(scheduled.recipientUserIds);
      const validRecipients = await this.revalidateRecipients(execution.organizationId, recipients);
      if (!validRecipients.length) {
        await this.scheduler.completeExecution(executionId, {
          delivered: 0,
          skipped: 'No eligible recipients.',
        });
        return;
      }
      const artifact = await this.artifacts.generate(
        execution.organizationId,
        scheduled.savedReport.reportKey as ReportKey,
        scheduled.savedReport.filters as Record<string, unknown>,
        scheduled.format as 'csv' | 'xlsx' | 'pdf',
      );
      const key = `automation/reports/${execution.organizationId}/${scheduled.id}/${execution.id}.${artifact.extension}`;
      await this.storage.ensureBucket();
      await this.storage.upload(key, artifact.buffer, artifact.contentType);
      const url = await this.storage.getSignedDownloadUrl(key);
      for (const recipient of validRecipients) {
        await this.email.enqueue(EMAIL_JOB_NAMES.scheduledReport, {
          to: recipient.email,
          subject: scheduled.name,
          text: `Your scheduled report "${scheduled.name}" is attached.`,
          html: `<p>Your scheduled report <strong>${escapeHtml(scheduled.name)}</strong> is attached.</p>`,
          attachments: [
            { filename: `${safeName(scheduled.name)}.${artifact.extension}`, path: url },
          ],
        });
      }
      await this.prisma.scheduledReport.update({
        where: { id: scheduled.id },
        data: { lastArtifactKey: key },
      });
      await this.scheduler.completeExecution(executionId, {
        delivered: validRecipients.length,
        artifactKey: key,
      });
      // Retention: this row only ever points at the newest artifact, so the one it pointed at
      // before this run is now unreachable through any DB row. Delete it once the new artifact and
      // its pointer are both durably committed, rather than accumulate one orphaned object per run
      // forever. Best-effort -- the report already delivered successfully either way.
      if (scheduled.lastArtifactKey && scheduled.lastArtifactKey !== key) {
        await this.storage.delete(scheduled.lastArtifactKey).catch((error: unknown) => {
          this.logger.warn({
            message: 'Superseded scheduled-report artifact could not be deleted',
            key: scheduled.lastArtifactKey,
            error,
          });
        });
      }
    } catch (error) {
      await this.scheduler.failExecution(executionId, error);
      throw error;
    }
  }

  private async revalidateRecipients(organizationId: string, userIds: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, status: UserStatus.ACTIVE },
      select: { id: true, email: true },
    });
    const eligible: typeof users = [];
    for (const user of users) {
      try {
        const context = await this.access.requireMembership(user.id, organizationId);
        if (context.permissions.has('reports.view')) eligible.push(user);
      } catch {
        // Revoked recipients are intentionally skipped, never emailed stale tenant data.
      }
    }
    return eligible;
  }
}

function readScheduledReportId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Scheduled report job payload is invalid.');
  const id = (value as Record<string, unknown>).scheduledReportId;
  if (typeof id !== 'string') throw new Error('Scheduled report job has no report ID.');
  return id;
}

function readRecipients(value: unknown) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error('Scheduled report recipients are invalid.');
  return [...new Set(value)];
}

function safeName(value: string) {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'report';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
