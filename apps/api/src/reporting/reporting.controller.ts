import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { ReportExportService } from './report-export.service.js';
import {
  CreateSavedReportDto,
  ReportExportQueryDto,
  ReportKeyParamDto,
  ReportQueryDto,
  UpdateSavedReportDto,
} from './reporting.dto.js';
import { ReportingService } from './reporting.service.js';

@Controller('organizations/:organizationId/reports')
@UseGuards(SessionGuard, OrganizationGuard)
export class ReportingController {
  constructor(
    private readonly reports: ReportingService,
    private readonly exports: ReportExportService,
    private readonly auth: AuthService,
  ) {}

  @Get('definitions')
  @RequirePermission('reports.view')
  definitions() {
    return { data: this.reports.definitions() };
  }

  @Get('filter-options')
  @RequirePermission('reports.view')
  async filterOptions(@Req() request: OrganizationRequest) {
    return { data: await this.reports.filterOptions(request.organization.id) };
  }

  @Get('saved')
  @RequirePermission('reports.view')
  async saved(@Req() request: OrganizationRequest) {
    return { data: await this.reports.listSaved(request.organization.id, request.auth.user.id) };
  }

  @Post('saved')
  @HttpCode(201)
  @RequirePermission('reports.manage')
  async createSaved(@Body() input: CreateSavedReportDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.reports.createSaved(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch('saved/:savedReportId')
  @RequirePermission('reports.manage')
  async updateSaved(
    @Param('savedReportId', new ParseUUIDPipe()) savedReportId: string,
    @Body() input: UpdateSavedReportDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.reports.updateSaved(
        request.organization,
        request.auth.user,
        savedReportId,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Delete('saved/:savedReportId')
  @HttpCode(204)
  @RequirePermission('reports.manage')
  async deleteSaved(
    @Param('savedReportId', new ParseUUIDPipe()) savedReportId: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.reports.deleteSaved(
      request.organization,
      request.auth.user,
      savedReportId,
      requestMetadata(request, this.auth.pepper),
    );
  }

  @Get(':reportKey/export')
  @RequirePermission('reports.view')
  async exportReport(
    @Param() params: ReportKeyParamDto,
    @Query() query: ReportExportQueryDto,
    @Req() request: OrganizationRequest,
    @Res() response: Response,
  ) {
    await this.exports.export(response, request.organization.id, params.reportKey, query);
  }

  @Get(':reportKey')
  @RequirePermission('reports.view')
  async runReport(
    @Param() params: ReportKeyParamDto,
    @Query() query: ReportQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.reports.run(request.organization.id, params.reportKey, query) };
  }
}
