import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';

import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { GetStatementQueryDto } from './statements.dto.js';
import { StatementsService } from './statements.service.js';

@Controller('organizations/:organizationId/customers/:contactId/statement')
@UseGuards(SessionGuard, OrganizationGuard)
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  @Get()
  @RequirePermission('sales.statements.view')
  async get(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Query() query: GetStatementQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.statements.getStatement(request.organization.id, contactId, query) };
  }
}
