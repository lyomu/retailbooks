import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, type AttachmentEntityType } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { StorageService } from '../storage/storage.service.js';

export interface UploadedFileLike {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

/**
 * Exported so the upload interceptors can refuse an oversized body *before* multer buffers it.
 * The service check below is the authoritative one — an interceptor limit is transport
 * configuration and a caller could reach the service another way — but on its own it fires only
 * after the whole file is already resident in memory.
 */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/**
 * Generic attachment storage shared by Bills and Expenses (and any future entity), wrapping the
 * already-generic `StorageService` -- not a Purchases-specific concern, so it lives in its own
 * top-level module rather than nested under `purchases/`. Callers (e.g. `BillsController`) own
 * their own routes and `@RequirePermission` decorators (upload/list fold under the parent entity's
 * own `.manage`/`.view` permission -- there is no separate attachment permission key), and just
 * delegate to this service for the storage-and-bookkeeping mechanics.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    context: OrganizationContext,
    user: PublicUser,
    entityType: AttachmentEntityType,
    entityId: string,
    file: UploadedFileLike,
    metadata: RequestMetadata,
    options?: { visibility?: 'INTERNAL' | 'CUSTOMER'; portalUserId?: string },
  ) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('Attachment exceeds the 15MB size limit.');
    }
    validateAttachment(file);
    const visibility = options?.portalUserId ? 'CUSTOMER' : (options?.visibility ?? 'INTERNAL');
    const storageKey = `${context.id}/${entityType.toLowerCase()}/${entityId}/${randomUUID()}-${safeKeySegment(file.originalname)}`;

    await this.storage.ensureBucket();
    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    const attachment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          organizationId: context.id,
          entityType,
          entityId,
          filename: file.originalname,
          contentType: file.mimetype,
          storageKey,
          sizeBytes: file.size,
          uploadedByUserId: user.id,
          visibility,
          portalUserId: options?.portalUserId ?? null,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'attachments.uploaded',
        entityType: entityType.toLowerCase(),
        entityId,
        action: AuditAction.CREATE,
        after: { filename: file.originalname, sizeBytes: file.size, visibility },
        ipHash: metadata.ipHash,
      });
      await tx.activity.create({
        data: {
          organizationId: context.id,
          targetType: entityType,
          targetId: entityId,
          kind: 'ATTACHMENT',
          visibility,
          eventKey: 'attachments.uploaded',
          actorUserId: user.id,
          portalUserId: options?.portalUserId ?? null,
          metadata: { attachmentId: created.id, filename: file.originalname },
        },
      });
      return created;
    });

    return summarize(attachment);
  }

  async list(organizationId: string, entityType: AttachmentEntityType, entityId: string) {
    const attachments = await this.prisma.attachment.findMany({
      where: { organizationId, entityType, entityId },
      orderBy: [{ createdAt: 'desc' }],
    });
    // Listing never authorizes a download. A dedicated, re-authorized endpoint issues the
    // short-lived URL only after target access has been checked again.
    return attachments.map(summarize);
  }

  async download(
    organizationId: string,
    entityType: AttachmentEntityType,
    entityId: string,
    attachmentId: string,
  ) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, organizationId, entityType, entityId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    return {
      id: attachment.id,
      downloadUrl: await this.storage.getSignedDownloadUrl(attachment.storageKey, 300),
    };
  }

  async listCustomer(organizationId: string, entityType: AttachmentEntityType, entityId: string) {
    const attachments = await this.prisma.attachment.findMany({
      where: { organizationId, entityType, entityId, visibility: 'CUSTOMER' },
      orderBy: [{ createdAt: 'desc' }],
    });
    return attachments.map(summarize);
  }

  async downloadCustomer(
    organizationId: string,
    entityType: AttachmentEntityType,
    entityId: string,
    attachmentId: string,
  ) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, organizationId, entityType, entityId, visibility: 'CUSTOMER' },
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    return {
      id: attachment.id,
      downloadUrl: await this.storage.getSignedDownloadUrl(attachment.storageKey, 300),
    };
  }
}

/**
 * Reduces a client-supplied filename to one safe object-key segment.
 *
 * S3 and MinIO treat a key as an opaque string rather than a path, so `../` in a filename does not
 * escape the tenant prefix today. That is a property of the current storage backend, not of this
 * code, and it stops being true the moment a key is used to build a filesystem path — a local
 * export, a backup restore, a future filesystem driver. The stored `filename` column keeps the
 * original for display; only the key is constrained.
 */
function safeKeySegment(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '');
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'attachment';
}

function summarize(attachment: {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    createdAt: attachment.createdAt.toISOString(),
  };
}

const SUPPORTED_TYPES: Record<string, readonly string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  csv: ['text/csv', 'application/csv'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  txt: ['text/plain'],
};

function validateAttachment(file: UploadedFileLike): void {
  const extension = file.originalname.split('.').pop()?.toLowerCase();
  if (!extension || !SUPPORTED_TYPES[extension]?.includes(file.mimetype)) {
    throw new BadRequestException(
      'Only PDF, image, CSV, XLSX, DOCX, and plain-text attachments are supported.',
    );
  }
  const bytes = file.buffer;
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const zip = starts([0x50, 0x4b, 0x03, 0x04]);
  const valid =
    (extension === 'pdf' && starts([0x25, 0x50, 0x44, 0x46])) ||
    (extension === 'png' && starts([0x89, 0x50, 0x4e, 0x47])) ||
    ((extension === 'jpg' || extension === 'jpeg') && starts([0xff, 0xd8, 0xff])) ||
    ((extension === 'xlsx' || extension === 'docx') && zip) ||
    (extension === 'csv' && isText(bytes)) ||
    (extension === 'txt' && isText(bytes));
  if (!valid) throw new BadRequestException('The file contents do not match its declared type.');
}

function isText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  return (
    !sample.includes(0) &&
    sample.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32)
  );
}
