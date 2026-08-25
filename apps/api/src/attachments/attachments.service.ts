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

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

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
    const storageKey = `${context.id}/${entityType.toLowerCase()}/${entityId}/${randomUUID()}-${file.originalname}`;

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
