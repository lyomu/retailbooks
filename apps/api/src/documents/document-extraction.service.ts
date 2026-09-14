import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  type Attachment,
  type DocumentExtractionStatus,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { StorageService } from '../storage/storage.service.js';
import { MalwareScannerService } from './malware-scanner.service.js';
import { OcrService, type OcrLine } from './ocr.service.js';
import { PdfRasterizerService } from './pdf-rasterizer.service.js';
import { extractReceiptCandidate } from './receipt-extractor.js';

const TERMINAL_STATUSES = new Set<DocumentExtractionStatus>([
  'QUARANTINED',
  'UNSUPPORTED_FOR_EXTRACTION',
  'READY_FOR_REVIEW',
]);

const OCR_SUPPORTED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);

class ExtractionStepError extends Error {
  constructor(
    readonly reason: string,
    cause: unknown,
  ) {
    super(`${reason}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * The pipeline a `document-extraction` job runs. Every branch below either reaches a terminal,
 * legitimate business outcome (quarantined / unsupported / ready for review -- the job succeeds) or
 * rethrows so BullMQ's configured attempts/backoff retries a genuinely transient failure (scanner
 * outage, OCR timeout, a storage read that didn't match its recorded hash).
 */
@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scanner: MalwareScannerService,
    private readonly ocr: OcrService,
    private readonly pdfRasterizer: PdfRasterizerService,
  ) {}

  async process(attachmentId: string): Promise<void> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || !attachment.contentHash) return;

    const extraction = await this.prisma.documentExtraction.upsert({
      where: { attachmentId: attachment.id },
      create: {
        organizationId: attachment.organizationId,
        attachmentId: attachment.id,
        entityType: attachment.entityType,
        entityId: attachment.entityId,
        contentHash: attachment.contentHash,
        status: 'PENDING',
      },
      update: {},
    });
    if (TERMINAL_STATUSES.has(extraction.status)) return;

    let scanEngineVersion: string | null = null;

    try {
      await this.setStatus(extraction.id, 'SCANNING');
      const bytes = await this.storage.download(attachment.storageKey);
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      if (actualHash !== attachment.contentHash) {
        throw new ExtractionStepError(
          'CONTENT_HASH_MISMATCH',
          new Error('Downloaded bytes do not match the recorded upload hash.'),
        );
      }

      const duplicateOfAttachmentId = await this.findDuplicate(attachment);

      let scan;
      try {
        [scan, scanEngineVersion] = await Promise.all([
          this.scanner.scan(bytes),
          this.scanner.version(),
        ]);
      } catch (error) {
        throw new ExtractionStepError('SCANNER_UNAVAILABLE', error);
      }
      if (!scan.clean) {
        await this.finish(extraction.id, attachment, 'QUARANTINED', {
          scanSignature: scan.signature,
          scanEngineVersion,
          duplicateOfAttachmentId,
        });
        return;
      }

      if (!OCR_SUPPORTED_CONTENT_TYPES.has(attachment.contentType)) {
        await this.finish(extraction.id, attachment, 'UNSUPPORTED_FOR_EXTRACTION', {
          scanEngineVersion,
          duplicateOfAttachmentId,
        });
        return;
      }

      await this.setStatus(extraction.id, 'OCR_PROCESSING');
      let lines: OcrLine[];
      let text: string;
      try {
        if (attachment.contentType === 'application/pdf') {
          const pageImages = await this.pdfRasterizer.rasterize(bytes);
          lines = [];
          const texts: string[] = [];
          for (let index = 0; index < pageImages.length; index += 1) {
            const pageImage = pageImages[index];
            if (!pageImage) continue;
            const result = await this.ocr.recognize(pageImage, index + 1);
            lines.push(...result.lines);
            texts.push(result.text);
          }
          text = texts.join('\n');
        } else {
          const result = await this.ocr.recognize(bytes, 1);
          lines = [...result.lines];
          text = result.text;
        }
      } catch (error) {
        throw new ExtractionStepError('OCR_FAILED', error);
      }

      await this.setStatus(extraction.id, 'EXTRACTING');
      const [vendors, categories] = await Promise.all([
        this.prisma.vendor.findMany({
          where: { organizationId: attachment.organizationId },
          select: { id: true, displayName: true },
        }),
        this.categoryCandidatesFor(attachment),
      ]);
      const candidate = extractReceiptCandidate(lines, vendors, categories);
      const ocrTextHash = createHash('sha256').update(text).digest('hex');

      await this.prisma.$transaction(async (tx) => {
        await tx.documentExtraction.update({
          where: { id: extraction.id },
          data: {
            status: 'READY_FOR_REVIEW',
            scanEngineVersion,
            duplicateOfAttachmentId,
            ocrTextHash,
            ocrText: text,
            sourceRegions: candidate.sourceRegions as unknown as Prisma.InputJsonValue,
            candidateVendorName: candidate.vendorName,
            candidateVendorId: candidate.vendorId,
            candidateDate: candidate.date ? new Date(`${candidate.date}T00:00:00.000Z`) : null,
            candidateCurrency: candidate.currency,
            candidateSubtotalMinor: candidate.subtotalMinor,
            candidateTaxMinor: candidate.taxMinor,
            candidateTotalMinor: candidate.totalMinor,
            candidateCategoryId: candidate.categoryId,
            arithmeticValid: candidate.arithmeticValid,
            fieldFlags: candidate.fieldFlags,
          },
        });
        await writeAuditEvent(tx, {
          organizationId: attachment.organizationId,
          actorUserId: null,
          eventKey: 'documents.extraction_ready',
          entityType: attachment.entityType.toLowerCase(),
          entityId: attachment.entityId,
          action: AuditAction.UPDATE,
          after: {
            attachmentId: attachment.id,
            status: 'READY_FOR_REVIEW',
            arithmeticValid: candidate.arithmeticValid,
            duplicateOfAttachmentId,
          },
        });
      });
    } catch (error) {
      const reason = error instanceof ExtractionStepError ? error.reason : 'FAILED';
      this.logger.warn({ message: 'Document extraction failed', attachmentId, reason, error });
      await this.finish(extraction.id, attachment, 'FAILED', {
        failureReason: reason,
        scanEngineVersion,
      });
      throw error;
    }
  }

  /** An Expense's "category" is an ExpenseCategory; a Bill has no such concept and posts lines
   * straight to a ledger account, so its category candidates are expense-like accounts instead. Any
   * other entity type (e.g. a future attachment source) gets no category candidates -- an unmatched,
   * flagged categoryId is honest; inventing a mapping the domain doesn't have would not be. */
  private async categoryCandidatesFor(
    attachment: Attachment,
  ): Promise<{ id: string; name: string }[]> {
    if (attachment.entityType === 'EXPENSE') {
      return this.prisma.expenseCategory.findMany({
        where: { organizationId: attachment.organizationId, active: true },
        select: { id: true, name: true },
      });
    }
    if (attachment.entityType === 'BILL') {
      const accounts = await this.prisma.ledgerAccount.findMany({
        where: {
          organizationId: attachment.organizationId,
          type: { in: ['EXPENSE', 'COST_OF_SALES'] },
          status: 'ACTIVE',
        },
        select: { id: true, name: true },
      });
      return accounts;
    }
    return [];
  }

  /** Same organization, identical bytes, a different attachment: an informational signal only --
   * never blocks review, matches "flag likely duplicates," not "reject." */
  private async findDuplicate(attachment: Attachment): Promise<string | null> {
    const match = await this.prisma.attachment.findFirst({
      where: {
        organizationId: attachment.organizationId,
        contentHash: attachment.contentHash,
        id: { not: attachment.id },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return match?.id ?? null;
  }

  private async setStatus(extractionId: string, status: DocumentExtractionStatus): Promise<void> {
    await this.prisma.documentExtraction.update({ where: { id: extractionId }, data: { status } });
  }

  private async finish(
    extractionId: string,
    attachment: Attachment,
    status: DocumentExtractionStatus,
    extra?: {
      scanSignature?: string | null;
      scanEngineVersion?: string | null;
      duplicateOfAttachmentId?: string | null;
      failureReason?: string;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.documentExtraction.update({
        where: { id: extractionId },
        data: {
          status,
          scanSignature: extra?.scanSignature ?? null,
          scanEngineVersion: extra?.scanEngineVersion ?? null,
          duplicateOfAttachmentId: extra?.duplicateOfAttachmentId ?? null,
          failureReason: extra?.failureReason ?? null,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: attachment.organizationId,
        actorUserId: null,
        eventKey: `documents.extraction_${status.toLowerCase()}`,
        entityType: attachment.entityType.toLowerCase(),
        entityId: attachment.entityId,
        action: AuditAction.UPDATE,
        after: { attachmentId: attachment.id, status, ...extra },
      });
    });
  }
}
