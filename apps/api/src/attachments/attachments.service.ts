import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
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
  ) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('Attachment exceeds the 15MB size limit.');
    }
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
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'attachments.uploaded',
        entityType: entityType.toLowerCase(),
        entityId,
        action: AuditAction.CREATE,
        after: { filename: file.originalname, sizeBytes: file.size },
        ipHash: metadata.ipHash,
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
    return Promise.all(
      attachments.map(async (attachment) => ({
        ...summarize(attachment),
        downloadUrl: await this.storage.getSignedDownloadUrl(attachment.storageKey),
      })),
    );
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
