import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import {
  CreateWorkflowRuleDto,
  UpdateWorkflowRuleDto,
  WorkflowDryRunDto,
  WorkflowStatusDto,
} from './workflow.dto.js';
import { WorkflowsService } from './workflows.service.js';

@Controller('organizations/:organizationId/automation/workflow-rules')
@UseGuards(SessionGuard, OrganizationGuard)
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('automation.rules.view')
  async list(@Req() request: OrganizationRequest) {
    return { data: await this.workflows.list(request.organization.id) };
  }

  @Post()
  @RequirePermission('automation.rules.manage')
  async create(@Body() input: CreateWorkflowRuleDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.workflows.create(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch(':ruleId')
  @RequirePermission('automation.rules.manage')
  async update(
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Body() input: UpdateWorkflowRuleDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.workflows.updateRule(
        request.organization,
        request.auth.user,
        ruleId,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch(':ruleId/status')
  @RequirePermission('automation.rules.manage')
  async status(
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Body() input: WorkflowStatusDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.workflows.setStatus(
        request.organization,
        request.auth.user,
        ruleId,
        input.status,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Post(':ruleId/dry-run')
  @RequirePermission('automation.rules.manage')
  async dryRun(
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Body() input: WorkflowDryRunDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.workflows.dryRun(request.organization.id, ruleId, input.payload ?? {}),
    };
  }

  @Get(':ruleId/runs')
  @RequirePermission('automation.rules.view')
  async runs(
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Query('limit') limit: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const parsed = limit ? Number(limit) : undefined;
    return {
      data: await this.workflows.listRuns(
        request.organization.id,
        ruleId,
        Number.isFinite(parsed) && parsed ? parsed : undefined,
      ),
    };
  }
}
