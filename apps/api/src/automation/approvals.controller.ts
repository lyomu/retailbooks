import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { FeatureFlagGuard, RequireFeatureFlag } from '../platform/feature-flag.guard.js';
import { PHASE13_FEATURE_FLAGS } from '../platform/phase13-feature-flags.js';
import { ApprovalBriefingService } from './approval-briefing.service.js';
import {
  ApprovalDecisionDto,
  CreateApprovalPolicyDto,
  UpdateApprovalPolicyDto,
} from './approvals.dto.js';
import { ApprovalsService } from './approvals.service.js';

@Controller('organizations/:organizationId/automation/approval-policies')
@UseGuards(SessionGuard, OrganizationGuard, FeatureFlagGuard)
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly auth: AuthService,
    private readonly briefing: ApprovalBriefingService,
  ) {}

  @Get()
  @RequirePermission('automation.approvals.view')
  async list(@Req() request: OrganizationRequest) {
    return { data: await this.approvals.listPolicies(request.organization.id) };
  }

  @Post()
  @RequirePermission('automation.approvals.manage')
  async create(@Body() input: CreateApprovalPolicyDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.approvals.createPolicy(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Get('inbox')
  @RequirePermission('automation.approvals.view')
  async inbox(@Req() request: OrganizationRequest) {
    return { data: await this.approvals.inbox(request.organization, request.auth.user) };
  }

  @Get('requests/mine')
  @RequirePermission('automation.approvals.view')
  async submittedByMe(@Req() request: OrganizationRequest) {
    return { data: await this.approvals.submittedByMe(request.organization, request.auth.user) };
  }

  @Get('requests/:requestId')
  @RequirePermission('automation.approvals.view')
  async detail(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.approvals.detail(request.organization, requestId) };
  }

  @Get('requests/:requestId/briefing')
  @RequirePermission('automation.approvals.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.APPROVAL_AUTOMATION)
  async briefingFor(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.briefing.brief(request.organization.id, requestId) };
  }

  @Post('requests/:requestId/decision')
  @RequirePermission('automation.approvals.view')
  async decide(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() input: ApprovalDecisionDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.approvals.decide(
        request.organization,
        request.auth.user,
        requestId,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Post('requests/:requestId/cancel')
  @RequirePermission('automation.approvals.view')
  async cancel(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.approvals.cancel(
        request.organization,
        request.auth.user,
        requestId,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch(':policyId')
  @RequirePermission('automation.approvals.manage')
  async update(
    @Param('policyId', new ParseUUIDPipe()) policyId: string,
    @Body() input: UpdateApprovalPolicyDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.approvals.updatePolicy(
        request.organization,
        request.auth.user,
        policyId,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Post(':policyId/activate')
  @RequirePermission('automation.approvals.manage')
  async activate(
    @Param('policyId', new ParseUUIDPipe()) policyId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.approvals.setPolicyStatus(
        request.organization,
        request.auth.user,
        policyId,
        'ACTIVE',
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Post(':policyId/deactivate')
  @RequirePermission('automation.approvals.manage')
  async deactivate(
    @Param('policyId', new ParseUUIDPipe()) policyId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.approvals.setPolicyStatus(
        request.organization,
        request.auth.user,
        policyId,
        'INACTIVE',
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }
}
