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
  CreateFinancialAccountDto,
  ListFinancialAccountsQueryDto,
  UpdateFinancialAccountDto,
} from './financial-accounts.dto.js';
import { FinancialAccountsService } from './financial-accounts.service.js';

@Controller('organizations/:organizationId/financial-accounts')
@UseGuards(SessionGuard, OrganizationGuard)
export class FinancialAccountsController {
  constructor(
    private readonly accounts: FinancialAccountsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('banking.accounts.view')
  async list(@Query() query: ListFinancialAccountsQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.accounts.list(request.organization.id, query.active) };
  }

  @Get(':financialAccountId')
  @RequirePermission('banking.accounts.view')
  async detail(
    @Param('financialAccountId', new ParseUUIDPipe()) financialAccountId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.accounts.detail(request.organization.id, financialAccountId) };
  }

  @Post()
  @RequirePermission('banking.accounts.manage')
  async create(@Body() input: CreateFinancialAccountDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.accounts.create(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':financialAccountId')
  @RequirePermission('banking.accounts.manage')
  async update(
    @Param('financialAccountId', new ParseUUIDPipe()) financialAccountId: string,
    @Body() input: UpdateFinancialAccountDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.accounts.update(
        request.organization,
        request.auth.user,
        financialAccountId,
        input,
        metadata,
      ),
    };
  }
}
