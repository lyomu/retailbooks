import { Injectable, NotFoundException } from '@nestjs/common';
import type { AttachmentEntityType } from '@prisma/client';
import { ApprovalTargetType } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

/** Not every entity type this pack can be assembled for is a valid `ApprovalTargetType` -- notably
 * `EXPENSE`, one of this route's three supported entity types, isn't in that enum at all (Expenses
 * don't go through the approval-policy system). Querying `approvalRequest` with an invalid enum
 * value throws a Prisma validation error before any other section of the pack can be returned, so
 * this must be checked first rather than cast past with `as unknown as ApprovalTargetType`. */
const APPROVAL_TARGET_TYPES = new Set<string>(Object.values(ApprovalTargetType));

export interface AuditEvidencePack {
  readonly entityType: string;
  readonly entityId: string;
  readonly auditEvents: {
    eventKey: string;
    action: string;
    occurredAt: string;
    actorUserId: string | null;
  }[];
  readonly attachments: { id: string; filename: string; createdAt: string }[];
  readonly approvalRequests: {
    id: string;
    status: string;
    submittedAt: string;
    decisions: { decision: string; createdAt: string; comment: string | null }[];
  }[];
  readonly journal: {
    id: string;
    reference: string | null;
    status: string;
    postedAt: string | null;
  } | null;
  readonly reversalJournal: {
    id: string;
    reference: string | null;
    postedAt: string | null;
  } | null;
}

/**
 * Deterministic audit evidence assembly: every field below is a plain read of an already-existing,
 * already-authorized record (audit log, attachments, approval decisions, posting/reversal) for one
 * entity -- nothing here is generated or inferred. Currently only Expense has the direct
 * `journalId` FK this pack follows for the posting/reversal section; other entity types still get
 * their audit/attachment/approval sections, just no direct journal linkage yet.
 */
@Injectable()
export class AuditEvidencePackService {
  constructor(private readonly prisma: PrismaService) {}

  async assemble(
    organizationId: string,
    entityType: AttachmentEntityType,
    entityId: string,
  ): Promise<AuditEvidencePack> {
    const [auditEvents, attachments, approvalRequests, journalLink] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where: { organizationId, entityType: entityType.toLowerCase(), entityId },
        orderBy: { occurredAt: 'asc' },
        take: 200,
        select: { eventKey: true, action: true, occurredAt: true, actorUserId: true },
      }),
      this.prisma.attachment.findMany({
        where: { organizationId, entityType, entityId },
        select: { id: true, filename: true, createdAt: true },
      }),
      APPROVAL_TARGET_TYPES.has(entityType)
        ? this.prisma.approvalRequest.findMany({
            where: {
              organizationId,
              targetType: entityType as ApprovalTargetType,
              targetId: entityId,
            },
            include: { steps: { include: { decisions: true } } },
          })
        : Promise.resolve([]),
      entityType === 'EXPENSE'
        ? this.prisma.expense.findFirst({
            where: { id: entityId, organizationId },
            select: {
              journal: {
                select: {
                  id: true,
                  reference: true,
                  status: true,
                  postedAt: true,
                  reversalOfJournalId: true,
                },
              },
            },
          })
        : null,
    ]);
    if (
      auditEvents.length === 0 &&
      attachments.length === 0 &&
      approvalRequests.length === 0 &&
      !journalLink
    ) {
      throw new NotFoundException('No evidence found for this entity.');
    }

    let reversalJournal: AuditEvidencePack['reversalJournal'] = null;
    if (journalLink?.journal) {
      const reversal = await this.prisma.journal.findFirst({
        where: { organizationId, reversalOfJournalId: journalLink.journal.id },
        select: { id: true, reference: true, postedAt: true },
      });
      if (reversal) {
        reversalJournal = {
          id: reversal.id,
          reference: reversal.reference,
          postedAt: reversal.postedAt?.toISOString() ?? null,
        };
      }
    }

    return {
      entityType,
      entityId,
      auditEvents: auditEvents.map((event) => ({
        eventKey: event.eventKey,
        action: event.action,
        occurredAt: event.occurredAt.toISOString(),
        actorUserId: event.actorUserId,
      })),
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        createdAt: attachment.createdAt.toISOString(),
      })),
      approvalRequests: approvalRequests.map((request) => ({
        id: request.id,
        status: request.status,
        submittedAt: request.submittedAt.toISOString(),
        decisions: request.steps.flatMap((step) =>
          step.decisions.map((decision) => ({
            decision: decision.decision,
            createdAt: decision.createdAt.toISOString(),
            comment: decision.comment,
          })),
        ),
      })),
      journal: journalLink?.journal
        ? {
            id: journalLink.journal.id,
            reference: journalLink.journal.reference,
            status: journalLink.journal.status,
            postedAt: journalLink.journal.postedAt?.toISOString() ?? null,
          }
        : null,
      reversalJournal,
    };
  }
}
