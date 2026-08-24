import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';

import { AuditLogQueryDto } from './audit-log.dto.js';
import { AuditLogService } from './audit-log.service.js';
import { RequirePermission, type OrganizationRequest } from './organization-context.js';
import { OrganizationGuard } from './organization.guard.js';
import { SessionGuard } from '../auth/session.guard.js';

@Controller('organizations/:organizationId/audit-log')
@UseGuards(SessionGuard, OrganizationGuard)
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @RequirePermission('audit.view')
  async list(@Query() query: AuditLogQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.auditLog.list(request.organization.id, query) };
  }
}
