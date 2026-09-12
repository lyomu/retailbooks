import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { EmailQueueService } from '../src/jobs/email-queue.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { CreditNotesService } from '../src/sales/credit-notes.service.js';
import { CustomersService } from '../src/sales/customers.service.js';
import { DocumentRenderingService } from '../src/sales/document-rendering.service.js';
import { InvoicesService } from '../src/sales/invoices.service.js';
import { parsePdfRenderSnapshot } from '../src/sales/pdf-render-snapshot.js';
import { QuotesService } from '../src/sales/quotes.service.js';
import { createTestHarness, type TestHarness } from './support/app.js';

const metadata = {
  ipHash: 'issued-document-snapshots-test',
  userAgent: 'RetailBooks integration test',
};

/**
 * GAPS #38: issued documents must render PDFs from immutable snapshots -- the display data frozen
 * at issue/approval time -- never from the mutable live `organization`/`contact` records. Each test
 * issues a document, then renames both source records, and proves the PDF still renders with the
 * issue-time names and that a re-send never re-renders from the changed records.
 */
describe('issued documents render PDFs from frozen snapshots, not live records', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let customers: CustomersService;
  let invoices: InvoicesService;
  let creditNotes: CreditNotesService;
  let quotes: QuotesService;
  let documentRendering: DocumentRenderingService;
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
    quotes = harness.app.get(QuotesService);
    documentRendering = harness.app.get(DocumentRenderingService);
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
        email: 'issued-document-snapshots-owner@example.test',
        displayName: 'Issued Document Snapshots Owner',
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

  /** Renames both live source records the legacy PDF path used to read at send time. */
  async function renameSourceRecords(): Promise<void> {
    await harness.prisma.contact.update({
      where: { id: contactId },
      data: { displayName: 'Acme Retail (rebranded)' },
    });
    await harness.prisma.organization.update({
      where: { id: context.id },
      data: { legalName: 'Document Books Ltd (restyled)' },
    });
  }
  it('renders an issued invoice PDF from the issue-time snapshot after the customer and org are renamed', async () => {
    const renderPdf = vi
      .spyOn(documentRendering, 'renderPdf')
      .mockResolvedValue(Buffer.from('%PDF'));
    vi.spyOn(emailQueue, 'enqueue').mockResolvedValue(undefined);

    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    // The render payload is frozen inside the issue transaction.
    const invoice = await harness.prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    const frozen = parsePdfRenderSnapshot(invoice.pdfSnapshot);
    expect(frozen?.organizationName).toBe('Document Books Ltd');
    expect(frozen?.contactName).toBe('Acme Retail');
    expect(frozen?.lines[0]).toMatchObject({ descriptionSnapshot: 'Widget' });
    expect(frozen?.totalMinor).toBe('1000');

    await renameSourceRecords();
    await invoices.sendInvoice(context, owner, issued.id, metadata);

    const pdfHtml = renderPdf.mock.calls[0]?.[0] as string;
    expect(pdfHtml).toContain('Document Books Ltd');
    expect(pdfHtml).not.toContain('restyled');
    expect(pdfHtml).toContain('Acme Retail');
    expect(pdfHtml).not.toContain('rebranded');
    // The frozen snapshot still carries the issue-time values after the rename.
    const after = await harness.prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    const frozenAfter = parsePdfRenderSnapshot(after.pdfSnapshot);
    expect(frozenAfter?.organizationName).toBe('Document Books Ltd');
    expect(frozenAfter?.contactName).toBe('Acme Retail');
  }, 30_000);

  it('re-sends from the cached DocumentSnapshot, never re-rendering from changed records', async () => {
    const renderPdf = vi
      .spyOn(documentRendering, 'renderPdf')
      .mockResolvedValue(Buffer.from('%PDF'));
    vi.spyOn(emailQueue, 'enqueue').mockResolvedValue(undefined);

    const draft = await invoices.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Widget', quantity: '1', unitPriceMinor: '1000' }] },
      metadata,
    );
    const issued = await invoices.issueInvoice(context, owner, draft.id, metadata);

    await renameSourceRecords();
    await invoices.sendInvoice(context, owner, issued.id, metadata);
    const firstHtml = renderPdf.mock.calls[0]?.[0] as string;
    expect(firstHtml).not.toContain('restyled');

    // Even a second wave of renames on top of a rendered document cannot change the cached PDF.
    await harness.prisma.contact.update({
      where: { id: contactId },
      data: { displayName: 'Acme Retail (renamed twice)' },
    });
    await invoices.sendInvoice(context, owner, issued.id, metadata);

    expect(renderPdf).toHaveBeenCalledTimes(1);
    const snapshots = await harness.prisma.documentSnapshot.count({
      where: { organizationId: context.id, documentType: 'INVOICE', documentId: issued.id },
    });
    expect(snapshots).toBe(1);
  }, 30_000);
  it('renders an issued credit note PDF from the issue-time snapshot after renames', async () => {
    const renderPdf = vi
      .spyOn(documentRendering, 'renderPdf')
      .mockResolvedValue(Buffer.from('%PDF'));
    vi.spyOn(emailQueue, 'enqueue').mockResolvedValue(undefined);

    const draft = await creditNotes.createDraft(
      context,
      owner,
      { contactId, lines: [{ description: 'Return', quantity: '1', unitPriceMinor: '500' }] },
      metadata,
    );
    const issued = await creditNotes.issueCreditNote(context, owner, draft.id, metadata);

    const creditNote = await harness.prisma.creditNote.findUniqueOrThrow({
      where: { id: issued.id },
    });
    const frozen = parsePdfRenderSnapshot(creditNote.pdfSnapshot);
    expect(frozen?.organizationName).toBe('Document Books Ltd');
    expect(frozen?.contactName).toBe('Acme Retail');

    await renameSourceRecords();
    await creditNotes.sendCreditNote(context, owner, issued.id, metadata);

    const pdfHtml = renderPdf.mock.calls[0]?.[0] as string;
    expect(pdfHtml).toContain('Document Books Ltd');
    expect(pdfHtml).not.toContain('restyled');
    expect(pdfHtml).toContain('Acme Retail');
    expect(pdfHtml).not.toContain('rebranded');
  }, 30_000);

  it('renders an approved quote PDF from the approval-time snapshot after renames', async () => {
    const renderPdf = vi
      .spyOn(documentRendering, 'renderPdf')
      .mockResolvedValue(Buffer.from('%PDF'));
    vi.spyOn(emailQueue, 'enqueue').mockResolvedValue(undefined);

    const draft = await quotes.createDraft(
      context,
      owner,
      {
        contactId,
        lines: [{ description: 'Proposal widget', quantity: '2', unitPriceMinor: '1500' }],
      },
      metadata,
    );
    const submitted = await quotes.submitForApproval(context, owner, draft.id, metadata);
    const approved = await quotes.approve(context, owner, submitted.id, metadata);

    // The render payload is frozen when the quote is approved (its last editable state).
    const quote = await harness.prisma.quote.findUniqueOrThrow({ where: { id: approved.id } });
    const frozen = parsePdfRenderSnapshot(quote.pdfSnapshot);
    expect(frozen?.organizationName).toBe('Document Books Ltd');
    expect(frozen?.contactName).toBe('Acme Retail');

    await renameSourceRecords();
    await quotes.send(context, owner, approved.id, metadata);

    const pdfHtml = renderPdf.mock.calls[0]?.[0] as string;
    expect(pdfHtml).toContain('Document Books Ltd');
    expect(pdfHtml).not.toContain('restyled');
    expect(pdfHtml).toContain('Acme Retail');
    expect(pdfHtml).not.toContain('rebranded');
  }, 30_000);
});
