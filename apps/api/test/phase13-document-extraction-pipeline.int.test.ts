import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PublicUser } from '../src/auth/auth.service.js';
import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import { DocumentExtractionService } from '../src/documents/document-extraction.service.js';
import { MalwareScannerService } from '../src/documents/malware-scanner.service.js';
import { OcrService } from '../src/documents/ocr.service.js';
import { PdfRasterizerService } from '../src/documents/pdf-rasterizer.service.js';
import { FiscalPeriodsService } from '../src/organizations/fiscal-periods.service.js';
import { LedgerService } from '../src/organizations/ledger.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import type { OrganizationContext } from '../src/organizations/organization-context.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { ExpensesService } from '../src/purchases/expenses.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';
import { buildMinimalPdf } from './support/minimal-pdf.js';

const metadata = {
  ipHash: 'phase13-document-extraction-pipeline-test',
  userAgent: 'RetailBooks document-extraction pipeline test',
};

// A genuinely valid, decodable 1x1 white PNG -- not a magic-byte prefix followed by prose, so
// tesseract.js can actually run recognition on it rather than failing to parse the image.
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// A genuinely valid, hand-built single-page PDF (see minimal-pdf.ts) with real receipt-like text
// tesseract.js can actually read once the page is rasterized -- not a magic-byte prefix.
const VALID_PDF = buildMinimalPdf([
  'Acme PDF Testing Co',
  'Date: 2026-03-15',
  'Subtotal 500.00',
  'VAT 50.00',
  'Total 550.00',
]);

// The EICAR antivirus test string: every real AV engine, ClamAV included, flags this exact 68-byte
// ASCII string as a "virus" without it containing any real malicious payload.
const EICAR_STRING = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'ascii',
);

/**
 * Live round trip through the real pipeline `document-extraction.service.ts` runs -- SHA-256
 * verify, a real TCP scan against the ClamAV container from docker-compose, and real OCR via
 * tesseract.js -- not just the pure `extractReceiptCandidate` function already covered by
 * `receipt-extractor.test.ts`. `DocumentExtractionService` only lives in the worker module
 * (`document-extraction-worker.module.ts`), which the main API test harness does not boot (the
 * worker process consumes a BullMQ queue that isn't running in this test process either), so its
 * dependencies are constructed directly here, reusing the harness's real `PrismaService` and
 * `ConfigService` -- the same Postgres, MinIO, and ClamAV backends the harness's HTTP upload route
 * already writes to.
 */
describe('Document extraction pipeline against a real ClamAV and OCR backend', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let periods: FiscalPeriodsService;
  let ledger: LedgerService;
  let expenses: ExpensesService;
  let extraction: DocumentExtractionService;
  let owner: PublicUser;
  let context: OrganizationContext;
  let cookie: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    periods = harness.app.get(FiscalPeriodsService);
    ledger = harness.app.get(LedgerService);
    expenses = harness.app.get(ExpensesService);

    const config = harness.app.get(ConfigService);
    const storage = harness.app.get(StorageService, { strict: false });
    extraction = new DocumentExtractionService(
      harness.prisma,
      storage,
      new MalwareScannerService(config),
      new OcrService(config),
      new PdfRasterizerService(),
    );
  });

  afterAll(async () => harness.close());

  beforeEach(async () => {
    await harness.reset();
    const user = await harness.prisma.user.create({
      data: {
        email: 'extraction-pipeline-owner@example.test',
        displayName: 'Extraction Pipeline Owner',
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
      { legalName: 'Extraction Pipeline Ltd', businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const draft = await access.requireMembership(owner.id, created.id);
    await organizations.finalize(draft, owner, metadata);
    context = await access.requireMembership(owner.id, created.id);
    await periods.generateFiscalYear(context, owner, { startsOn: '2026-01-01' }, metadata);
    cookie = await sessionCookieFor(owner.id);
  });

  async function createExpense() {
    const bankAccount = await ledger.accountBySystemKey(context.id, 'bank_default');
    return expenses.createDraft(
      context,
      owner,
      {
        payeeName: 'Extraction pipeline vendor',
        expenseDate: '2026-02-01',
        paidThroughAccountId: bankAccount.id,
        amountMinor: '500',
      },
      metadata,
    );
  }

  async function uploadAttachment(
    filename: string,
    content: Buffer,
    contentType: string,
  ): Promise<{ attachmentId: string; expenseId: string }> {
    const expense = await createExpense();
    const uploadResponse = await harness
      .http()
      .post(`${API}/organizations/${context.id}/expenses/${expense.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', content, { filename, contentType })
      .expect(201);
    const attachmentId = (uploadResponse.body as { data: { id: string } }).data.id;
    return { attachmentId, expenseId: expense.id };
  }

  it('scans clean, OCR-supported bytes and reaches READY_FOR_REVIEW', async () => {
    const { attachmentId } = await uploadAttachment('receipt.png', VALID_PNG, 'image/png');

    await extraction.process(attachmentId);

    const record = await harness.prisma.documentExtraction.findUniqueOrThrow({
      where: { attachmentId },
    });
    expect(record.status).toBe('READY_FOR_REVIEW');
    expect(record.scanSignature).toBeNull();
    expect(record.scanEngineVersion).toMatch(/ClamAV/);
    expect(record.ocrTextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.ocrText).not.toBeNull();
    expect(record.failureReason).toBeNull();

    expect(
      await harness.prisma.auditEvent.count({
        where: {
          organizationId: context.id,
          entityId: (await harness.prisma.attachment.findUniqueOrThrow({
            where: { id: attachmentId },
          })).entityId,
          eventKey: 'documents.extraction_ready',
        },
      }),
    ).toBeGreaterThan(0);
  });

  it('rasterizes a real PDF page and OCRs the rendered image', async () => {
    const { attachmentId } = await uploadAttachment('receipt.pdf', VALID_PDF, 'application/pdf');

    await extraction.process(attachmentId);

    const record = await harness.prisma.documentExtraction.findUniqueOrThrow({
      where: { attachmentId },
    });
    expect(record.status).toBe('READY_FOR_REVIEW');
    expect(record.scanEngineVersion).toMatch(/ClamAV/);
    expect(record.ocrText).toContain('Acme PDF Testing Co');
    expect(record.candidateTotalMinor).toBe(55000n);
    expect(record.arithmeticValid).toBe(true);
  });

  it('quarantines a real ClamAV-detected signature before any OCR runs', async () => {
    const { attachmentId } = await uploadAttachment('eicar.txt', EICAR_STRING, 'text/plain');

    await extraction.process(attachmentId);

    const record = await harness.prisma.documentExtraction.findUniqueOrThrow({
      where: { attachmentId },
    });
    expect(record.status).toBe('QUARANTINED');
    expect(record.scanSignature).not.toBeNull();
    expect(record.scanSignature?.toUpperCase()).toContain('EICAR');
    expect(record.scanEngineVersion).toMatch(/ClamAV/);
    // Quarantine happens before OCR: no OCR text should ever be recorded for infected bytes.
    expect(record.ocrText).toBeNull();
    expect(record.ocrTextHash).toBeNull();
  });

  it('marks a clean file whose content type is not OCR-supported as unsupported, not stuck or failed', async () => {
    const cleanText = Buffer.from('Just a plain clean note, not a receipt.', 'ascii');
    const { attachmentId } = await uploadAttachment('note.txt', cleanText, 'text/plain');

    await extraction.process(attachmentId);

    const record = await harness.prisma.documentExtraction.findUniqueOrThrow({
      where: { attachmentId },
    });
    expect(record.status).toBe('UNSUPPORTED_FOR_EXTRACTION');
    expect(record.scanSignature).toBeNull();
    expect(record.scanEngineVersion).toMatch(/ClamAV/);
    expect(record.ocrText).toBeNull();
  });

  async function sessionCookieFor(userId: string): Promise<string> {
    const token = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${token}`;
  }
});
