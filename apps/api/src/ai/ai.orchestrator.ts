import { createHash } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { OrganizationAccessService } from '../organizations/organization-access.service.js';
import { ReportingService } from '../reporting/reporting.service.js';
import type { ReportRow } from '@retailbooks/contracts';

import { AskReportDto, ExplainNumberDto } from './ai.dto.js';
import { AiGatewayException, AiModelGateway, type AiEvidenceEnvelope } from './ai-model.gateway.js';
import { AiStore, type AiEvidenceReference } from './ai.store.js';

const CAPABILITY = 'REPORT_EXPLANATION';
const NUMBER_CAPABILITY = 'NUMBER_EXPLANATION';

@Injectable()
export class AiOrchestrator {
  constructor(
    private readonly reports: ReportingService,
    private readonly gateway: AiModelGateway,
    private readonly store: AiStore,
    private readonly access: OrganizationAccessService,
  ) {}

  async explainReport(
    organization: OrganizationContext,
    actor: PublicUser,
    input: AskReportDto,
    metadata: RequestMetadata,
  ) {
    const contextRowLimit = this.gateway.maxContextRows();
    const filters = {
      from: input.from,
      to: input.to,
      basis: input.basis,
      currencyMode: input.currencyMode,
      projectId: input.projectId,
      tagId: input.tagId,
      page: 1,
      pageSize: Math.min(input.pageSize ?? contextRowLimit, contextRowLimit),
    };
    const report = await this.reports.run(organization.id, input.reportKey, filters);

    if (report.pagination.totalRows > report.rows.length) {
      throw new BadRequestException('Refine the report filters before asking for an explanation.');
    }
    if (report.rows.length === 0) {
      throw new BadRequestException(
        'This report has no source rows to explain for the selected filters.',
      );
    }

    const evidence = report.rows.map(toEvidenceReference);
    const envelope: AiEvidenceEnvelope = {
      reportKey: report.definition.key,
      filters: report.filters,
      baseCurrency: report.baseCurrency,
      totals: report.totals,
      rows: report.rows.map((row) => ({
        id: row.id,
        cells: row.cells,
        source: row.source
          ? { entityType: row.source.entityType, entityId: row.source.entityId }
          : null,
      })),
    };
    const descriptor = this.gateway.descriptor();
    const run = await this.store.createRun({
      organizationId: organization.id,
      actorUserId: actor.id,
      capability: CAPABILITY,
      provider: descriptor.provider,
      model: descriptor.model,
      modelVersion: descriptor.modelVersion,
      requestHash: hash({
        capability: CAPABILITY,
        question: input.question,
        report: envelope.reportKey,
      }),
      evidenceHash: hash(envelope),
      evidence,
      metadata,
    });

    try {
      const answer = await this.gateway.explain(input.question, envelope, organization.id);
      validateAnswer(answer, evidence);
      // The model call is asynchronous, so an access change made while it runs must take effect
      // before any prose or citation is returned to the caller.
      const refreshedOrganization = await this.access.requireMembership(actor.id, organization.id);
      if (!refreshedOrganization.permissions.has('reports.view')) {
        throw new AiGatewayException('MODEL_EVIDENCE_UNAUTHORIZED');
      }
      const refreshedReport = await this.reports.run(
        refreshedOrganization.id,
        input.reportKey,
        filters,
      );
      ensureCompleteReport(refreshedReport);
      const refreshedEvidence = refreshedReport.rows.map(toEvidenceReference);
      validateAnswer(answer, refreshedEvidence);
      validateEvidenceVersions(answer.citationIds, evidence, refreshedEvidence);
      const completed = await this.store.completeRun({
        organizationId: organization.id,
        runId: run.id,
        actorUserId: actor.id,
        outputHash: hash(answer),
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        metadata,
      });

      return {
        run: serializeRun(completed),
        answer: {
          summary: answer.summary,
          abstained: answer.abstained,
          citations: answer.citationIds.map((id) => citationFor(id, refreshedEvidence)),
        },
        // This is the authoritative report response. The AI summary never replaces it.
        report: refreshedReport,
      };
    } catch (error) {
      const failureCode =
        error instanceof AiGatewayException ? error.failureCode : 'MODEL_OUTPUT_REJECTED';
      await this.store.failRun({
        organizationId: organization.id,
        runId: run.id,
        actorUserId: actor.id,
        failureCode,
        metadata,
      });
      if (error instanceof AiGatewayException) throw error;
      throw new AiGatewayException(failureCode);
    }
  }

  /**
   * "Explain a number": the deterministic drill-down is authoritative and always returned. The
   * model only adds interpretation on top of it, so unlike explainReport, an AI failure or
   * disabled mode returns 200 with the deterministic result and an explicit unavailable state
   * instead of blocking the caller. A mid-flight authorization loss is the one exception: it still
   * fails closed with no data, exactly like explainReport.
   */
  async explainNumber(
    organization: OrganizationContext,
    actor: PublicUser,
    input: ExplainNumberDto,
    metadata: RequestMetadata,
  ) {
    const drillDown = await this.reports.drillDown(
      organization.id,
      input.reportKey,
      input,
      input.rowId,
    );

    const descriptor = this.gateway.descriptor();
    if (descriptor.provider === 'DISABLED') {
      return {
        drillDown,
        explanation: { state: 'unavailable' as const, reason: 'MODEL_DISABLED' },
      };
    }

    const question = input.resolvedQuestion();
    const evidence = drillDown.lines.map(toEvidenceReference);
    const envelope: AiEvidenceEnvelope = {
      reportKey: input.reportKey,
      filters: drillDown.filters,
      baseCurrency: drillDown.baseCurrency,
      totals: drillDown.row.cells,
      rows: drillDown.lines.map((row) => ({
        id: row.id,
        cells: row.cells,
        source: row.source
          ? { entityType: row.source.entityType, entityId: row.source.entityId }
          : null,
      })),
    };
    const run = await this.store.createRun({
      organizationId: organization.id,
      actorUserId: actor.id,
      capability: NUMBER_CAPABILITY,
      provider: descriptor.provider,
      model: descriptor.model,
      modelVersion: descriptor.modelVersion,
      requestHash: hash({
        capability: NUMBER_CAPABILITY,
        question,
        reportKey: input.reportKey,
        rowId: input.rowId,
      }),
      evidenceHash: hash(envelope),
      evidence,
      metadata,
    });

    try {
      const answer = await this.gateway.explain(question, envelope, organization.id);
      validateAnswer(answer, evidence);
      const refreshedOrganization = await this.access.requireMembership(actor.id, organization.id);
      if (!refreshedOrganization.permissions.has('reports.view')) {
        throw new AiGatewayException('MODEL_EVIDENCE_UNAUTHORIZED');
      }
      const refreshedDrillDown = await this.reports.drillDown(
        refreshedOrganization.id,
        input.reportKey,
        input,
        input.rowId,
      );
      const refreshedEvidence = refreshedDrillDown.lines.map(toEvidenceReference);
      validateAnswer(answer, refreshedEvidence);
      validateEvidenceVersions(answer.citationIds, evidence, refreshedEvidence);
      const completed = await this.store.completeRun({
        organizationId: organization.id,
        runId: run.id,
        actorUserId: actor.id,
        outputHash: hash(answer),
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        metadata,
      });

      return {
        run: serializeRun(completed),
        drillDown: refreshedDrillDown,
        explanation: {
          state: 'ready' as const,
          summary: answer.summary,
          abstained: answer.abstained,
          citations: answer.citationIds.map((id) => citationFor(id, refreshedEvidence)),
        },
      };
    } catch (error) {
      const failureCode =
        error instanceof AiGatewayException ? error.failureCode : 'MODEL_OUTPUT_REJECTED';
      await this.store.failRun({
        organizationId: organization.id,
        runId: run.id,
        actorUserId: actor.id,
        failureCode,
        metadata,
      });
      if (failureCode === 'MODEL_EVIDENCE_UNAUTHORIZED') {
        if (error instanceof AiGatewayException) throw error;
        throw new AiGatewayException(failureCode);
      }
      // The number itself never blocks on an AI failure: recompute it fresh so a slow/failed model
      // call can never return a number that is more stale than a plain report view would be.
      const freshDrillDown = await this.reports.drillDown(
        organization.id,
        input.reportKey,
        input,
        input.rowId,
      );
      return {
        drillDown: freshDrillDown,
        explanation: { state: 'unavailable' as const, reason: failureCode },
      };
    }
  }
}

function ensureCompleteReport(report: {
  pagination: { totalRows: number };
  rows: readonly ReportRow[];
}): void {
  if (report.pagination.totalRows !== report.rows.length || report.rows.length === 0) {
    throw new AiGatewayException('MODEL_EVIDENCE_STALE');
  }
}

function validateEvidenceVersions(
  citationIds: readonly string[],
  original: readonly AiEvidenceReference[],
  refreshed: readonly AiEvidenceReference[],
): void {
  const originalVersions = new Map(
    original.map((reference) => [reference.sourceId, reference.sourceVersion]),
  );
  const refreshedVersions = new Map(
    refreshed.map((reference) => [reference.sourceId, reference.sourceVersion]),
  );
  if (citationIds.some((id) => originalVersions.get(id) !== refreshedVersions.get(id))) {
    throw new AiGatewayException('MODEL_EVIDENCE_STALE');
  }
}

function toEvidenceReference(row: ReportRow): AiEvidenceReference {
  return {
    // A report can contain several lines from one underlying entity. The report-row id is the
    // unique citation handle; href still leads to the underlying, independently authorized source.
    sourceType: 'REPORT_ROW',
    sourceId: row.id,
    sourceVersion: hash({ id: row.id, cells: row.cells, source: row.source }),
    href: row.source?.href ?? null,
  };
}

function validateAnswer(
  answer: { summary: string; citationIds: readonly string[]; abstained: boolean },
  evidence: readonly AiEvidenceReference[],
): void {
  if (/\d/.test(answer.summary)) {
    throw new Error('Model output included a numeric value.');
  }
  const ids = new Set(evidence.map((reference) => reference.sourceId));
  if (answer.citationIds.some((id) => !ids.has(id))) {
    throw new Error('Model output included an unsupported citation.');
  }
  if (!answer.abstained && answer.citationIds.length === 0) {
    throw new Error('A non-abstained answer needs evidence.');
  }
}

function citationFor(id: string, evidence: readonly AiEvidenceReference[]) {
  const reference = evidence.find((candidate) => candidate.sourceId === id);
  if (!reference) throw new Error('Model output included an unsupported citation.');
  return {
    sourceType: reference.sourceType,
    sourceId: reference.sourceId,
    href: reference.href,
  };
}

function serializeRun(run: {
  id: string;
  capability: string;
  provider: string;
  model: string;
  modelVersion: string | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: run.id,
    capability: run.capability,
    provider: run.provider,
    model: run.model,
    modelVersion: run.modelVersion,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
