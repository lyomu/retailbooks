import { Injectable } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import { writeAuditEvent } from '../organizations/audit-event.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';

export interface AiEvidenceReference {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly href: string | null;
}

export interface CreateAiRunInput {
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly capability: string;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string | null;
  readonly requestHash: string;
  readonly evidenceHash: string;
  readonly evidence: readonly AiEvidenceReference[];
  readonly metadata: RequestMetadata;
}

@Injectable()
export class AiStore {
  constructor(private readonly prisma: PrismaService) {}

  async createRun(input: CreateAiRunInput) {
    return this.inOrganization(input.organizationId, async (tx) => {
      const run = await tx.aiRun.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          capability: input.capability,
          provider: input.provider,
          model: input.model,
          modelVersion: input.modelVersion,
          requestHash: input.requestHash,
          evidenceHash: input.evidenceHash,
          evidence: {
            create: input.evidence.map((reference) => ({
              organizationId: input.organizationId,
              sourceType: reference.sourceType,
              sourceId: reference.sourceId,
              sourceVersion: reference.sourceVersion,
              href: reference.href,
            })),
          },
        },
        include: { evidence: true },
      });
      await writeAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        eventKey: 'ai.run_started',
        entityType: 'AiRun',
        entityId: run.id,
        action: AuditAction.CREATE,
        after: {
          capability: run.capability,
          provider: run.provider,
          model: run.model,
          evidenceCount: run.evidence.length,
        },
        ipHash: input.metadata.ipHash,
      });
      return run;
    });
  }

  async completeRun(input: {
    organizationId: string;
    runId: string;
    actorUserId: string;
    outputHash: string;
    inputTokens: number | null;
    outputTokens: number | null;
    metadata: RequestMetadata;
  }) {
    return this.inOrganization(input.organizationId, async (tx) => {
      const run = await tx.aiRun.update({
        where: { id: input.runId },
        data: {
          status: 'SUCCEEDED',
          outputHash: input.outputHash,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          completedAt: new Date(),
        },
      });
      await writeAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        eventKey: 'ai.run_completed',
        entityType: 'AiRun',
        entityId: run.id,
        action: AuditAction.UPDATE,
        after: { status: run.status, inputTokens: run.inputTokens, outputTokens: run.outputTokens },
        ipHash: input.metadata.ipHash,
      });
      return run;
    });
  }

  async failRun(input: {
    organizationId: string;
    runId: string;
    actorUserId: string;
    failureCode: string;
    metadata: RequestMetadata;
  }): Promise<void> {
    await this.inOrganization(input.organizationId, async (tx) => {
      const run = await tx.aiRun.update({
        where: { id: input.runId },
        data: { status: 'FAILED', failureCode: input.failureCode, completedAt: new Date() },
      });
      await writeAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        eventKey: 'ai.run_failed',
        entityType: 'AiRun',
        entityId: run.id,
        action: AuditAction.UPDATE,
        after: { status: run.status, failureCode: run.failureCode },
        ipHash: input.metadata.ipHash,
      });
    });
  }

  async purgeExpired(organizationId: string, before: Date): Promise<number> {
    return this.inOrganization(organizationId, async (tx) => {
      const deleted = await tx.aiRun.deleteMany({
        where: {
          createdAt: { lt: before },
          status: { in: ['SUCCEEDED', 'FAILED', 'REJECTED'] },
        },
      });
      if (deleted.count > 0) {
        await writeAuditEvent(tx, {
          organizationId,
          actorUserId: null,
          eventKey: 'ai.runs_purged',
          entityType: 'AiRun',
          action: AuditAction.DELETE,
          after: { deletedRunCount: deleted.count, expiredBefore: before.toISOString() },
        });
      }
      return deleted.count;
    });
  }

  async inOrganization<T>(
    organizationId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      return work(tx);
    });
  }
}
