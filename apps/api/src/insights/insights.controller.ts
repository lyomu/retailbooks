import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { FeatureFlagGuard, RequireFeatureFlag } from '../platform/feature-flag.guard.js';
import { PHASE13_FEATURE_FLAGS } from '../platform/phase13-feature-flags.js';
import { AuditEvidencePackService } from './audit-evidence-pack.service.js';
import { CashFlowScenarioService } from './cash-flow-scenario.service.js';
import { CloseChecklistService } from './close-checklist.service.js';
import { CollectionsPrioritizerService } from './collections-prioritizer.service.js';
import { CountryPackQaService } from './country-pack-qa.service.js';
import { InventoryPurchasingAdviserService } from './inventory-purchasing-adviser.service.js';
import { ProjectMarginAdviserService } from './project-margin-adviser.service.js';
import { VarianceInsightService } from './variance-insight.service.js';

class PolicyQaQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;
}

const AUDIT_EVIDENCE_ENTITY_TYPES = ['EXPENSE', 'BILL', 'INVOICE'] as const;

class AuditEvidenceQueryDto {
  @IsIn(AUDIT_EVIDENCE_ENTITY_TYPES)
  entityType!: (typeof AUDIT_EVIDENCE_ENTITY_TYPES)[number];

  @IsUUID()
  entityId!: string;
}

@Controller('organizations/:organizationId/insights')
@UseGuards(SessionGuard, OrganizationGuard, FeatureFlagGuard)
export class InsightsController {
  constructor(
    private readonly varianceInsights: VarianceInsightService,
    private readonly closeChecklist: CloseChecklistService,
    private readonly cashFlow: CashFlowScenarioService,
    private readonly collections: CollectionsPrioritizerService,
    private readonly inventoryPurchasing: InventoryPurchasingAdviserService,
    private readonly projectMargins: ProjectMarginAdviserService,
    private readonly policyQa: CountryPackQaService,
    private readonly evidencePack: AuditEvidencePackService,
  ) {}

  @Get('variance')
  @RequirePermission('reports.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS)
  async variance(@Req() request: OrganizationRequest) {
    return { data: await this.varianceInsights.detect(request.organization.id) };
  }

  @Get('close-checklist')
  @RequirePermission('reports.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.APPROVAL_AUTOMATION)
  async closeChecklistFor(@Req() request: OrganizationRequest) {
    return { data: await this.closeChecklist.build(request.organization.id) };
  }

  @Get('cash-flow')
  @RequirePermission('insights.cash_flow.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.ADVISORY_CASH_FLOW)
  async cashFlowFor(@Req() request: OrganizationRequest) {
    return { data: await this.cashFlow.project(request.organization.id) };
  }

  @Get('collections')
  @RequirePermission('insights.collections.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.ADVISORY_COLLECTIONS)
  async collectionsFor(@Req() request: OrganizationRequest) {
    return { data: await this.collections.rank(request.organization.id) };
  }

  @Get('inventory-purchasing')
  @RequirePermission('insights.inventory.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.ADVISORY_INVENTORY)
  async inventoryPurchasingFor(@Req() request: OrganizationRequest) {
    return { data: await this.inventoryPurchasing.advise(request.organization.id) };
  }

  @Get('project-margins')
  @RequirePermission('insights.project_margin.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.ADVISORY_PROJECT_MARGIN)
  async projectMarginsFor(@Req() request: OrganizationRequest) {
    return { data: await this.projectMargins.advise(request.organization.id) };
  }

  @Get('policy-qa')
  @RequirePermission('insights.policy_qa.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.ADVISORY_POLICY_QA)
  async policyQaFor(@Query() query: PolicyQaQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.policyQa.search(request.organization.id, query.q) };
  }

  @Get('audit-evidence-pack')
  @RequirePermission('insights.evidence_packs.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.ADVISORY_EVIDENCE_PACKS)
  async auditEvidencePackFor(
    @Query() query: AuditEvidenceQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.evidencePack.assemble(
        request.organization.id,
        query.entityType,
        query.entityId,
      ),
    };
  }
}
