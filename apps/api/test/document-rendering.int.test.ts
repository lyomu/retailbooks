import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { EmailQueueService } from '../src/jobs/email-queue.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CreditNotesService } from '../src/sales/credit-notes.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'document-rendering-test',
  userAgent: 'RetailBooks integration test',
};

describe('document rendering and send delivery against a real database', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let creditNotes: CreditNotesService;
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
    invoices = harness.app.get(InvoicesService);
    creditNotes = harness.app.get(CreditNotesService);
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
        email: 'document-rendering-owner@example.test',
        displayName: 'Document Rendering Owner',
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
      { legalName: 'Document Books Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
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

  it('renders an invoice once, caches it on re-send, but enqueues a fresh email job each time', async () => {
    const enqueueSpy = vi.spyOn(emailQueue, 'enqueue').mockResolvedValue(undefined);

    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    const firstSend = await invoices.sendInvoice(context, owner, issued.id, metadata);
    expect(firstSend.sentAt).not.toBeNull();
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0]?.[0]).toBe('invoice.send');
    expect(enqueueSpy.mock.calls[0]?.[1].to).toBe('acme@example.test');
    expect(enqueueSpy.mock.calls[0]?.[1].attachments).toHaveLength(1);

    const snapshotsAfterFirst = await harness.prisma.documentSnapshot.count({
      where: { organizationId: context.id, documentType: 'INVOICE', documentId: issued.id },
    });
    expect(snapshotsAfterFirst).toBe(1);
    const firstSentAt = firstSend.sentAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondSend = await invoices.sendInvoice(context, owner, issued.id, metadata);

    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    const snapshotsAfterSecond = await harness.prisma.documentSnapshot.count({
      where: { organizationId: context.id, documentType: 'INVOICE', documentId: issued.id },
    });
    expect(snapshotsAfterSecond).toBe(1);
    expect(secondSend.sentAt).not.toBe(firstSentAt);
  }, 30_000);

  it('rejects sending to a customer with no email address on file', async () => {
    const noEmailContact = await customers.create(
      context,
      owner,
      { displayName: 'No Email Co' },
      metadata,
    );
    const draft = await invoices.createDraft(
      context,
      owner,
      {
        contactId: noEmailContact.id,
        lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }],
      },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    await expect(invoices.sendInvoice(context, owner, issued.id, metadata)).rejects.toThrow(
      'This customer has no email address on file.',
    );
  });

  it('rejects sending a draft invoice', async () => {
    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    await expect(invoices.sendInvoice(context, owner, draft.id, metadata)).rejects.toThrow(
      'Only issued invoices can be sent.',
    );
  });

  it('renders a credit note and enqueues a credit_note.send job', async () => {
    vi.spyOn(emailQueue, 'enqueue').mockResolvedValue(undefined);
    const draft = await creditNotes.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '500' }] },
      metadata,
    );
    const issued = await creditNotes.issueCreditNote(context, owner, draft.id, metadata);

    const sent = await creditNotes.sendCreditNote(context, owner, issued.id, metadata);
    expect(sent.sentAt).not.toBeNull();

    const snapshot = await harness.prisma.documentSnapshot.count({
      where: { organizationId: context.id, documentType: 'CREDIT_NOTE', documentId: issued.id },
    });
    expect(snapshot).toBe(1);
  }, 30_000);
});
