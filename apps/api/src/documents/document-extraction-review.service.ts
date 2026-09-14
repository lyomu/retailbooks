import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  type DocumentExtraction,
  type DocumentExtractionDisposition,
} from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';

/**
 * API-side read/accept/reject surface for a Phase 13D extraction. Deliberately thin: it only ever
 * touches `disposition`/`reviewedAt`/`reviewedByUserId` on the extraction row it already owns. It
 * never creates, updates, or posts an Expense -- the reviewer still uses the existing Expense draft
 * routes for that, by hand, with whatever candidate values they choose to carry over.
 */
@Injectable()
export class DocumentExtractionReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, attachmentId: string) {
    const extraction = await this.prisma.documentExtraction.findFirst({
      where: { organizationId, attachmentId },
    });
    return extraction ? serialize(extraction) : null;
  }

  async accept(
    organizationId: string,
    attachmentId: string,
    actor: PublicUser,
    metadata: RequestMetadata,
  ) {
    return this.setDisposition(organizationId, attachmentId, 'ACCEPTED', actor, metadata);
  }

  async reject(
    organizationId: string,
    attachmentId: string,
    actor: PublicUser,
    metadata: RequestMetadata,
  ) {
    return this.setDisposition(organizationId, attachmentId, 'REJECTED', actor, metadata);
  }

  private async setDisposition(
    organizationId: string,
    attachmentId: string,
    disposition: DocumentExtractionDisposition,
    actor: PublicUser,
    metadata: RequestMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.documentExtraction.findFirst({
        where: { organizationId, attachmentId },
      });
      if (!existing) throw new NotFoundException('No extraction found for this attachment.');
      if (existing.status !== 'READY_FOR_REVIEW') {
        throw new BadRequestException('This extraction is not ready for review yet.');
      }
      const updated = await tx.documentExtraction.update({
        where: { id: existing.id },
        data: { disposition, reviewedAt: new Date(), reviewedByUserId: actor.id },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId: actor.id,
        eventKey: `documents.extraction_${disposition.toLowerCase()}`,
        entityType: existing.entityType.toLowerCase(),
        entityId: existing.entityId,
        action: AuditAction.UPDATE,
        after: { attachmentId, disposition },
        ipHash: metadata.ipHash,
      });
      return serialize(updated);
    });
  }
}

function serialize(extraction: DocumentExtraction) {
  return {
    id: extraction.id,
    attachmentId: extraction.attachmentId,
    status: extraction.status,
    failureReason: extraction.failureReason,
    scanSignature: extraction.scanSignature,
    duplicateOfAttachmentId: extraction.duplicateOfAttachmentId,
    candidate:
      extraction.status === 'READY_FOR_REVIEW'
        ? {
            vendorName: extraction.candidateVendorName,
            vendorId: extraction.candidateVendorId,
            date: extraction.candidateDate
              ? extraction.candidateDate.toISOString().slice(0, 10)
              : null,
            currency: extraction.candidateCurrency,
            subtotalMinor: extraction.candidateSubtotalMinor?.toString() ?? null,
            taxMinor: extraction.candidateTaxMinor?.toString() ?? null,
            totalMinor: extraction.candidateTotalMinor?.toString() ?? null,
            categoryId: extraction.candidateCategoryId,
            arithmeticValid: extraction.arithmeticValid,
            fieldFlags: extraction.fieldFlags,
            sourceRegions: extraction.sourceRegions,
          }
        : null,
    disposition: extraction.disposition,
    reviewedAt: extraction.reviewedAt?.toISOString() ?? null,
    createdAt: extraction.createdAt.toISOString(),
    updatedAt: extraction.updatedAt.toISOString(),
  };
}
