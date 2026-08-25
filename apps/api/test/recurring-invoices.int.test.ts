import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { EmailQueueService } from '../src/jobs/email-queue.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { RecurringInvoicesService } from '../src/sales/recurring-invoices.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'recurring-invoices-test',
  userAgent: 'RetailBooks integration test',
};

describe('recurring invoice generation against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let recurringInvoices: RecurringInvoicesService;
  let emailQueue: EmailQueueService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let contactId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    customers = harness.app.get(CustomersService);
    recurringInvoices = harness.app.get(RecurringInvoicesService);
    emailQueue = harness.app.get(EmailQueueService);
  });

  afterAll(async () => {
    await harness.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'recurring-invoices-owner@example.test',
        displayName: 'Recurring Invoices Owner',
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
      { legalName: 'Recurring Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draftContext = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draftContext, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);

    const contact = await customers.create(
      context,
      owner,
      { displayName: 'Acme Retail', email: 'acme@example.test' },
      metadata,
    );
    contactId = contact.id;
  });

  it('generates exactly one invoice for a due template, matching its lines, and advances nextRunDate', async () => {
    const template = await recurringInvoices.createTemplate(
      context,
      owner,
      {
        contactId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        lines: [{ description: 'Subscription', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );
    expect(template.nextRunDate).toBe('2026-01-15');

    const results = await recurringInvoices.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);
    expect(results[0]!.templateId).toBe(template.id);
    expect(results[0]!.invoiceId).toBeTruthy();

    const invoice = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: results[0]!.invoiceId! },
      include: { lines: true },
    });
    expect(invoice.status).toBe('ISSUED');
    expect(invoice.subtotalMinor).toBe(2500n);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]!.descriptionSnapshot).toBe('Subscription');

    const updatedTemplate = await recurringInvoices.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2026-02-15');
  });

  it('produces a draft-only invoice when autoCreate is false', async () => {
    const template = await recurringInvoices.createTemplate(
      context,
      owner,
      {
        contactId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        autoCreate: false,
        lines: [{ description: 'Subscription', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );

    const results = await recurringInvoices.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);
    expect(results[0]!.templateId).toBe(template.id);

    const invoice = await harness.prisma.invoice.findUniqueOrThrow({
      where: { id: results[0]!.invoiceId! },
    });
    expect(invoice.status).toBe('DRAFT');
  });

  it('sends the generated invoice when autoSend is true', async () => {
    const enqueueSpy = vi.spyOn(emailQueue, 'enqueue').mockResolvedValue(undefined);
    await recurringInvoices.createTemplate(
      context,
      owner,
      {
        contactId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        autoCreate: true,
        autoSend: true,
        lines: [{ description: 'Subscription', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );

    const results = await recurringInvoices.runDueTemplates(context, owner, metadata);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]?.[0]).toBe('invoice.send');

    const snapshot = await harness.prisma.documentSnapshot.count({
      where: {
        organizationId: context.id,
        documentType: 'INVOICE',
        documentId: results[0]!.invoiceId!,
      },
    });
    expect(snapshot).toBe(1);
  }, 30_000);

  it('clamps a month-end start date to the last valid day of the next month instead of overflowing', async () => {
    const template = await recurringInvoices.createTemplate(
      context,
      owner,
      {
        contactId,
        cadence: 'MONTHLY',
        startDate: '2026-01-31',
        lines: [{ description: 'Subscription', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );
    expect(template.nextRunDate).toBe('2026-01-31');

    const results = await recurringInvoices.runDueTemplates(context, owner, metadata);
    expect(results).toHaveLength(1);

    const updatedTemplate = await recurringInvoices.detail(context.id, template.id);
    // February 2026 has 28 days -- Date.prototype.setUTCMonth would otherwise overflow Jan 31 + 1
    // month into 2026-03-03 rather than clamping to the last valid day of February.
    expect(updatedTemplate.nextRunDate).toBe('2026-02-28');
  });

  it('concurrent double-trigger of runDueTemplates produces exactly one child invoice for the same due template', async () => {
    const template = await recurringInvoices.createTemplate(
      context,
      owner,
      {
        contactId,
        cadence: 'MONTHLY',
        startDate: '2026-01-15',
        lines: [{ description: 'Subscription', quantity: '1', unitPriceMinor: '2500' }],
      },
      metadata,
    );

    const [first, second] = await Promise.all([
      recurringInvoices.runDueTemplates(context, owner, metadata),
      recurringInvoices.runDueTemplates(context, owner, metadata),
    ]);

    const generatedInvoiceIds = [...first, ...second]
      .filter((result) => result.invoiceId)
      .map((result) => result.invoiceId!);
    expect(generatedInvoiceIds).toHaveLength(1);

    const invoiceCount = await harness.prisma.invoice.count({
      where: { organizationId: context.id, contactId },
    });
    expect(invoiceCount).toBe(1);

    const updatedTemplate = await recurringInvoices.detail(context.id, template.id);
    expect(updatedTemplate.nextRunDate).toBe('2026-02-15');

    const claimCount = await harness.prisma.ledgerIdempotencyKey.count({
      where: { organizationId: context.id, operation: 'RECURRING_INVOICE_GENERATE' },
    });
    expect(claimCount).toBe(1);
  });
});
