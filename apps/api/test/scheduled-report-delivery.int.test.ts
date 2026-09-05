import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { AutomationQueueService } from '../src/automation/automation-queue.service.js';
import { ScheduledReportRunnerService } from '../src/automation/scheduled-report-runner.service.js';
import { ScheduledReportsService } from '../src/automation/scheduled-reports.service.js';
import { SchedulerService } from '../src/automation/scheduler.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { EmailQueueService } from '../src/jobs/email-queue.service.js';
import { EMAIL_JOB_NAMES } from '../src/jobs/email-job.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { ReportArtifactService } from '../src/reporting/report-artifact.service.js';
import { ReportingService } from '../src/reporting/reporting.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'scheduled-report-delivery-test',
  userAgent: 'RetailBooks integration test',
};

describe('scheduled-report filter/tenant fidelity against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let reports: ReportingService;
  let scheduledReports: ScheduledReportsService;
  let runner: ScheduledReportRunnerService;
  let scheduler: SchedulerService;
  let artifacts: ReportArtifactService;
  let storage: StorageService;
  let email: EmailQueueService;
  let automationQueue: AutomationQueueService;
  let owner: PublicUser;
  let context: OrganizationContext;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    reports = harness.app.get(ReportingService);
    scheduledReports = harness.app.get(ScheduledReportsService);
    runner = new ScheduledReportRunnerService(
      harness.app.get(PrismaService),
      harness.app.get(SchedulerService),
      harness.app.get(OrganizationAccessService),
      harness.app.get(ReportArtifactService),
      harness.app.get(StorageService),
      harness.app.get(EmailQueueService),
    );
    scheduler = harness.app.get(SchedulerService);
    artifacts = harness.app.get(ReportArtifactService);
    storage = harness.app.get(StorageService);
    email = harness.app.get(EmailQueueService);
    automationQueue = harness.app.get(AutomationQueueService);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    vi.spyOn(automationQueue, 'enqueueScheduledExecution').mockResolvedValue();
    vi.spyOn(automationQueue, 'retryScheduledExecution').mockResolvedValue();
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'schedule-owner@example.test',
        displayName: 'Schedule Owner',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    owner = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
    const created = await organizations.create(
      owner,
      { legalName: 'Schedule Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
  });

  async function createSavedAndScheduled(name: string, savedFilters: Record<string, string>) {
    const saved = await reports.createSaved(
      context,
      owner,
      { name, reportKey: 'financial.profit-loss', filters: savedFilters },
      metadata,
    );
    const scheduled = await scheduledReports.create(
      context,
      owner,
      {
        name: `${name} (delivery)`,
        savedReportId: saved.id,
        recipientUserIds: [owner.id],
        format: 'csv',
        schedule: { cadence: 'DAILY', localTime: '09:00' },
      },
      metadata,
    );
    return { saved, scheduled };
  }

  /** Re-arms the scheduled report's job to a past moment, sweeps one execution, runs it. */
  async function armAndRun(scheduled: { scheduledJobId: string }, secondsAgo: number) {
    const job = await harness.prisma.scheduledJob.findUniqueOrThrow({
      where: { id: scheduled.scheduledJobId },
    });
    await harness.prisma.scheduledJob.update({
      where: { id: job.id },
      data: { nextRunAt: new Date(Date.now() - secondsAgo * 1_000) },
    });
    expect(await scheduler.sweep()).toBe(1);
    const execution = await harness.prisma.scheduledJobExecution.findFirstOrThrow({
      where: { scheduledJobId: job.id },
      orderBy: { createdAt: 'desc' },
    });
    await runner.execute(execution.id);
    return harness.prisma.scheduledJobExecution.findUniqueOrThrow({ where: { id: execution.id } });
  }
  it("generates the artifact from the saved report's filters, not an unfiltered run", async () => {
    const savedFilters = { from: '2026-01-01', to: '2026-06-30' };
    const { saved, scheduled } = await createSavedAndScheduled('Half-year P&L', savedFilters);

    const generateSpy = vi.spyOn(artifacts, 'generate');
    const settled = await armAndRun(scheduled, 60);

    expect(generateSpy).toHaveBeenCalledTimes(1);
    const [organizationId, key, calledFilters, format] = generateSpy.mock.calls[0]!;
    expect(organizationId).toBe(context.id);
    expect(key).toBe('financial.profit-loss');
    expect(calledFilters).toMatchObject(savedFilters);
    expect(format).toBe('csv');

    const result = settled.result as { delivered: number; artifactKey: string };
    expect(result.delivered).toBe(1);
    expect(result.artifactKey).toMatch(/^automation\/reports\//);
    expect(saved.id).toBeTruthy();
  });

  it('excludes a recipient who belongs to a different organization even when injected by fiat', async () => {
    const { saved, scheduled } = await createSavedAndScheduled('Tenant-bound P&L', {
      from: '2026-01-01',
      to: '2026-12-31',
    });

    const outsider = await harness.prisma.user.create({
      data: {
        email: 'outsider@example.test',
        displayName: 'Outsider',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const outsiderUser: PublicUser = {
      id: outsider.id,
      email: outsider.email,
      displayName: outsider.displayName,
      emailVerified: true,
      status: outsider.status,
    };
    const otherOrg = await organizations.create(
      outsiderUser,
      { legalName: 'Other Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const otherContext = await access.requireMembership(outsider.id, otherOrg.id);
    await organizations.finalize(otherContext, outsiderUser, metadata);

    // Bypass creation-time assertRecipients by injecting the outsider row directly.
    await harness.prisma.scheduledReport.update({
      where: { id: scheduled.id },
      data: { recipientUserIds: [owner.id, outsider.id] },
    });

    const emailSpy = vi.spyOn(email, 'enqueue');
    const settled = await armAndRun(scheduled, 60);

    expect((settled.result as { delivered: number }).delivered).toBe(1);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect((emailSpy.mock.calls[0]![1] as { to: string }).to).toBe(owner.email);
    expect(emailSpy.mock.calls[0]![0]).toBe(EMAIL_JOB_NAMES.scheduledReport);
    expect(saved.id).toBeTruthy();
  });

  it('retires the superseded artifact key after a second run, keeping only the newest', async () => {
    const { saved, scheduled } = await createSavedAndScheduled('Retention P&L', {
      from: '2026-01-01',
      to: '2026-12-31',
    });
    const deleteSpy = vi.spyOn(storage, 'delete');

    const first = await armAndRun(scheduled, 120);
    const key1 = (first.result as { artifactKey: string }).artifactKey;
    expect(deleteSpy).not.toHaveBeenCalled();

    const second = await armAndRun(scheduled, 60);
    const key2 = (second.result as { artifactKey: string }).artifactKey;
    expect(key2).not.toBe(key1);
    expect(deleteSpy).toHaveBeenCalledWith(key1);

    const current = await harness.prisma.scheduledReport.findUniqueOrThrow({
      where: { id: scheduled.id },
    });
    expect(current.lastArtifactKey).toBe(key2);

    // Existence check at the object-storage layer: the first key is gone, the second is present.
    const [firstUrl, secondUrl] = await Promise.all([
      storage.getSignedDownloadUrl(key1),
      storage.getSignedDownloadUrl(key2),
    ]);
    const firstResponse = await fetch(firstUrl);
    const secondResponse = await fetch(secondUrl);
    expect(firstResponse.status).toBe(404);
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.text()).toContain('Section');
    expect(saved.id).toBeTruthy();
  });
});
