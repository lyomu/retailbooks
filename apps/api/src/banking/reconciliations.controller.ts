import {
  Body,
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
import {
  ListReconciliationsQueryDto,
  ReopenReconciliationDto,
  SetClearedTransactionsDto,
  StartReconciliationDto,
} from './reconciliations.dto.js';
import { ReconciliationsService } from './reconciliations.service.js';

@Controller('organizations/:organizationId/reconciliations')
@UseGuards(SessionGuard, OrganizationGuard)
export class ReconciliationsController {
  constructor(
    private readonly reconciliations: ReconciliationsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('banking.reconciliations.view')
  async list(@Query() query: ListReconciliationsQueryDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.reconciliations.list(request.organization.id, query.financialAccountId),
    };
  }

  @Get(':reconciliationId')
  @RequirePermission('banking.reconciliations.view')
  async detail(
    @Param('reconciliationId', new ParseUUIDPipe()) reconciliationId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.reconciliations.detail(request.organization.id, reconciliationId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('banking.reconciliations.manage')
  async start(@Body() input: StartReconciliationDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.reconciliations.start(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Post(':reconciliationId/clear')
  @HttpCode(200)
  @RequirePermission('banking.reconciliations.manage')
  async clear(
    @Param('reconciliationId', new ParseUUIDPipe()) reconciliationId: string,
    @Body() input: SetClearedTransactionsDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.reconciliations.setCleared(
        request.organization,
        request.auth.user,
        reconciliationId,
        input,
        metadata,
        true,
      ),
    };
  }

  @Post(':reconciliationId/unclear')
  @HttpCode(200)
  @RequirePermission('banking.reconciliations.manage')
  async unclear(
    @Param('reconciliationId', new ParseUUIDPipe()) reconciliationId: string,
    @Body() input: SetClearedTransactionsDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.reconciliations.setCleared(
        request.organization,
        request.auth.user,
        reconciliationId,
        input,
        metadata,
        false,
      ),
    };
  }

  @Post(':reconciliationId/complete')
  @HttpCode(200)
  @RequirePermission('banking.reconciliations.manage')
  async complete(
    @Param('reconciliationId', new ParseUUIDPipe()) reconciliationId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.reconciliations.complete(
        request.organization,
        request.auth.user,
        reconciliationId,
        metadata,
      ),
    };
  }

  @Post(':reconciliationId/reopen')
  @HttpCode(200)
  @RequirePermission('banking.reconciliations.reopen')
  async reopen(
    @Param('reconciliationId', new ParseUUIDPipe()) reconciliationId: string,
    @Body() input: ReopenReconciliationDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.reconciliations.reopen(
        request.organization,
        request.auth.user,
        reconciliationId,
        input.reason,
        metadata,
      ),
    };
  }
}
