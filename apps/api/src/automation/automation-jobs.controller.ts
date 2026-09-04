import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { SchedulerService } from './scheduler.service.js';

@Controller('organizations/:organizationId/automation/jobs')
@UseGuards(SessionGuard, OrganizationGuard)
export class AutomationJobsController {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly auth: AuthService,
  ) {}

  @Get('failed')
  @RequirePermission('automation.jobs.view')
  async listFailed(@Query('limit') limit: string | undefined, @Req() request: OrganizationRequest) {
    const parsed = limit ? Number(limit) : undefined;
    return {
      data: await this.scheduler.listFailedExecutions(
        request.organization.id,
        Number.isFinite(parsed) && parsed ? parsed : undefined,
      ),
    };
  }

  @Get(':executionId')
  @RequirePermission('automation.jobs.view')
  async detail(
    @Param('executionId', new ParseUUIDPipe()) executionId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.scheduler.getExecution(request.organization.id, executionId) };
  }

  @Post(':executionId/retry')
  @HttpCode(200)
  @RequirePermission('automation.jobs.retry')
  async retry(
    @Param('executionId', new ParseUUIDPipe()) executionId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.scheduler.retryExecution(
        request.organization.id,
        request.auth.user,
        executionId,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }
}
