import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';

import { SessionGuard } from '../auth/session.guard.js';
import { AuditLogQueryDto } from './audit-log.dto.js';
import { AuditLogService } from './audit-log.service.js';
import { RequirePermission, type OrganizationRequest } from './organization-context.js';
import { OrganizationGuard } from './organization.guard.js';

@Controller('organizations/:organizationId/audit-log')
@UseGuards(SessionGuard, OrganizationGuard)
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @RequirePermission('audit.view')
  async list(@Query() query: AuditLogQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.auditLog.list(request.organization.id, query) };
  }

  @Get('export')
  @RequirePermission('audit.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  async export(@Query() query: AuditLogQueryDto, @Req() request: OrganizationRequest) {
    return this.auditLog.exportCsv(request.organization.id, query);
  }
}
