import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';

export interface CreateSuggestionInput {
  readonly organizationId: string;
  readonly runId?: string | null;
  readonly capability: string;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly payload: Prisma.InputJsonValue;
  readonly reason?: string | null;
  readonly expiresAt?: Date | null;
}

/**
 * Generic, capability-agnostic store for Phase 13E suggestions -- categorization, variance
 * insights, draft text. Mirrors `AiStore`'s transaction-local RLS context pattern and its
 * discipline of writing an audit event for every state change. Accepting a suggestion here only
 * ever records that decision; it never itself creates, updates, or posts anything in another
 * domain module.
 */
@Injectable()
export class AiSuggestionsStore {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSuggestionInput) {
    return this.inOrganization(input.organizationId, (tx) =>
      tx.aiSuggestion.create({
        data: {
          organizationId: input.organizationId,
          runId: input.runId ?? null,
          capability: input.capability,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          payload: input.payload,
          reason: input.reason ?? null,
          expiresAt: input.expiresAt ?? null,
        },
      }),
    );
  }

  async findPending(
    organizationId: string,
    capability: string,
    entityType: string,
    entityId: string,
  ) {
    return this.inOrganization(organizationId, (tx) =>
      tx.aiSuggestion.findFirst({
        where: { organizationId, capability, entityType, entityId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async list(organizationId: string, capability?: string) {
    return this.inOrganization(organizationId, (tx) =>
      tx.aiSuggestion.findMany({
        where: { organizationId, ...(capability ? { capability } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  async accept(
    organizationId: string,
    suggestionId: string,
    actorUserId: string,
    metadata: RequestMetadata,
  ) {
    return this.inOrganization(organizationId, async (tx) => {
      const existing = await this.claim(tx, organizationId, suggestionId);
      const updated = await tx.aiSuggestion.update({
        where: { id: existing.id },
        data: { status: 'ACCEPTED', reviewedAt: new Date(), reviewedByUserId: actorUserId },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId,
        eventKey: 'ai.suggestion_accepted',
        entityType: existing.entityType ?? 'AiSuggestion',
        entityId: existing.entityId ?? existing.id,
        action: AuditAction.UPDATE,
        after: { suggestionId, capability: existing.capability },
        ipHash: metadata.ipHash,
      });
      return updated;
    });
  }

  async dismiss(
    organizationId: string,
    suggestionId: string,
    actorUserId: string,
    metadata: RequestMetadata,
    note?: string,
  ) {
    return this.inOrganization(organizationId, async (tx) => {
      const existing = await this.claim(tx, organizationId, suggestionId);
      const updated = await tx.aiSuggestion.update({
        where: { id: existing.id },
        data: { status: 'DISMISSED', reviewedAt: new Date(), reviewedByUserId: actorUserId },
      });
      await tx.aiFeedback.create({
        data: {
          organizationId,
          suggestionId: existing.id,
          actorUserId,
          kind: 'DISMISSED',
          note: note ?? null,
        },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId,
        eventKey: 'ai.suggestion_dismissed',
        entityType: existing.entityType ?? 'AiSuggestion',
        entityId: existing.entityId ?? existing.id,
        action: AuditAction.UPDATE,
        after: { suggestionId, capability: existing.capability },
        ipHash: metadata.ipHash,
      });
      return updated;
    });
  }

  /** Records that an accepted suggestion turned out to be wrong -- feedback only, never a training
   * signal by default (per the "no tenant data for model training" requirement). Leaves `status`
   * untouched; a correction is about the value, not about whether it was reviewed. */
  async correct(
    organizationId: string,
    suggestionId: string,
    actorUserId: string,
    metadata: RequestMetadata,
    note: string,
  ) {
    return this.inOrganization(organizationId, async (tx) => {
      const existing = await tx.aiSuggestion.findFirst({
        where: { id: suggestionId, organizationId },
      });
      if (!existing) throw new NotFoundException('Suggestion not found.');
      await tx.aiFeedback.create({
        data: { organizationId, suggestionId: existing.id, actorUserId, kind: 'CORRECTED', note },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId,
        eventKey: 'ai.suggestion_corrected',
        entityType: existing.entityType ?? 'AiSuggestion',
        entityId: existing.entityId ?? existing.id,
        action: AuditAction.UPDATE,
        after: { suggestionId, capability: existing.capability },
        ipHash: metadata.ipHash,
      });
      return existing;
    });
  }

  private async claim(tx: Prisma.TransactionClient, organizationId: string, suggestionId: string) {
    const existing = await tx.aiSuggestion.findFirst({
      where: { id: suggestionId, organizationId },
    });
    if (!existing) throw new NotFoundException('Suggestion not found.');
    if (existing.status !== 'PENDING') {
      throw new BadRequestException('This suggestion has already been reviewed.');
    }
    return existing;
  }

  private async inOrganization<T>(
    organizationId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      return work(tx);
    });
  }
}
