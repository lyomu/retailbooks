import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledJobStatus } from '@prisma/client';
import type { PublicUser } from '../src/auth/auth.service.js';
import { AutomationQueueService } from '../src/automation/automation-queue.service.js';
import { RemindersService } from '../src/automation/reminders.service.js';
import { SchedulerService } from '../src/automation/scheduler.service.js';
import { EmailQueueService } from '../src/jobs/email-queue.service.js';
import { EMAIL_JOB_NAMES } from '../src/jobs/email-job.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'reminder-timing-test',
  userAgent: 'RetailBooks integration test',
};

describe('invoice reminder timing and execution against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let reminders: RemindersService;
  let scheduler: SchedulerService;
  let invoices: InvoicesService;
  let email: EmailQueueService;
  let automationQueue: AutomationQueueService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let contactId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    customers = harness.app.get(CustomersService);
    reminders = harness.app.get(RemindersService);
    scheduler = harness.app.get(SchedulerService);
    invoices = harness.app.get(InvoicesService);
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
        email: 'reminder-owner@example.test',
        displayName: 'Reminder Owner',
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
      { legalName: 'Reminder Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const contact = await customers.create(
      context,
      owner,
      { displayName: 'Reminder Customer', email: 'reminder-customer@example.test' },
      metadata,
    );
    contactId = contact.id;
  });

  /** One active policy + an ISSUED invoice with a known due date. */
  async function issuedInvoiceWithReminder(dueDate: string) {
    const policy = await reminders.create(
      context,
      owner,
      {
        name: 'Payment reminder',
        offsets: [-3, 0, 7],
        subject: 'Invoice {{invoiceNumber}} is due',
        bodyTemplate: 'Hi {{customerName}}, {{invoiceNumber}} is due on {{dueDate}}.',
      },
      metadata,
    );
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId,
        dueDate,
        lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }],
      },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);
    return { policy, issued };
  }

  /** Re-arms one job to a past moment, pauses its siblings, and sweeps it into one QUEUED execution. */
  async function executionFor(job: { id: string }) {
    await harness.prisma.scheduledJob.updateMany({
      where: { organizationId: context.id, handler: 'invoice.reminder', id: { not: job.id } },
      data: { status: ScheduledJobStatus.PAUSED },
    });
    await harness.prisma.scheduledJob.update({
      where: { id: job.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });
    const enqueued = await scheduler.sweep();
    expect(enqueued).toBe(1);
    return harness.prisma.scheduledJobExecution.findFirstOrThrow({
      where: { scheduledJobId: job.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  it('schedules one job per active policy offset at dueDate + offset', async () => {
    await issuedInvoiceWithReminder('2026-02-10');

    const jobs = await harness.prisma.scheduledJob.findMany({
      where: { organizationId: context.id, handler: 'invoice.reminder' },
      orderBy: { nextRunAt: 'asc' },
    });
    expect(jobs).toHaveLength(3);
    expect(jobs.map((job) => job.nextRunAt.toISOString().slice(0, 10))).toEqual([
      '2026-02-07', // dueDate - 3
      '2026-02-10', // dueDate + 0
      '2026-02-17', // dueDate + 7
    ]);
    const payload = jobs[0]!.payload as { invoiceId: string; reminderPolicyId: string };
    expect(payload.invoiceId).toBeTruthy();
    expect(payload.reminderPolicyId).toBeTruthy();
  });

  it('executes a due reminder and enqueues one invoice-reminder email', async () => {
    await issuedInvoiceWithReminder('2026-02-10');
    const job = await harness.prisma.scheduledJob.findFirstOrThrow({
      where: { organizationId: context.id, handler: 'invoice.reminder' },
      orderBy: { nextRunAt: 'asc' },
    });
    const execution = await executionFor(job);

    const emailSpy = vi.spyOn(email, 'enqueue');
    await reminders.execute(execution.id);

    const settled = await harness.prisma.scheduledJobExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(settled.status).toBe('SUCCEEDED');
    expect((settled.result as { delivered?: boolean }).delivered).toBe(true);
    expect(emailSpy).toHaveBeenCalledTimes(1);
    const [name, message] = emailSpy.mock.calls[0]!;
    expect(name).toBe(EMAIL_JOB_NAMES.invoiceReminder);
    expect((message as { to: string }).to).toBe('reminder-customer@example.test');
    expect(settled.scheduledJobId).toBe(job.id);
    expect(
      await harness.prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'COMPLETED',
    });
  });

  it('skips -- never emails -- when the invoice is voided between scheduling and execute', async () => {
    const { issued } = await issuedInvoiceWithReminder('2026-02-10');
    const job = await harness.prisma.scheduledJob.findFirstOrThrow({
      where: { organizationId: context.id, handler: 'invoice.reminder' },
      orderBy: { nextRunAt: 'asc' },
    });
    const execution = await executionFor(job);

    await invoices.voidInvoice(context, owner, issued.id, metadata);
    const emailSpy = vi.spyOn(email, 'enqueue');
    await reminders.execute(execution.id);

    const settled = await harness.prisma.scheduledJobExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    expect(settled.status).toBe('SUCCEEDED');
    expect((settled.result as { skipped?: string }).skipped).toMatch(/no longer eligible/i);
    expect(emailSpy).not.toHaveBeenCalled();
  });
});
