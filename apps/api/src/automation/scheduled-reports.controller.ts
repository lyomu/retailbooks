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
import {
  CreateScheduledReportDto,
  ScheduledReportActiveDto,
  UpdateScheduledReportDto,
} from './scheduled-reports.dto.js';
import { ScheduledReportsService } from './scheduled-reports.service.js';

@Controller('organizations/:organizationId/reports/scheduled')
@UseGuards(SessionGuard, OrganizationGuard)
export class ScheduledReportsController {
  constructor(
    private readonly reports: ScheduledReportsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('automation.schedules.view')
  async list(@Req() request: OrganizationRequest) {
    return { data: await this.reports.list(request.organization.id) };
  }

  @Post()
  @RequirePermission('automation.schedules.manage')
  async create(@Body() input: CreateScheduledReportDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.reports.create(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch(':scheduledReportId')
  @RequirePermission('automation.schedules.manage')
  async update(
    @Param('scheduledReportId', new ParseUUIDPipe()) scheduledReportId: string,
    @Body() input: UpdateScheduledReportDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.reports.update(
        request.organization,
        request.auth.user,
        scheduledReportId,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch(':scheduledReportId/active')
  @RequirePermission('automation.schedules.manage')
  async active(
    @Param('scheduledReportId', new ParseUUIDPipe()) scheduledReportId: string,
    @Body() input: ScheduledReportActiveDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.reports.setActive(
        request.organization,
        request.auth.user,
        scheduledReportId,
        input.active,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }
}
