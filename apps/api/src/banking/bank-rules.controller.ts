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
import { CreateBankRuleDto, UpdateBankRuleDto } from './bank-rules.dto.js';
import { BankRulesService } from './bank-rules.service.js';

@Controller('organizations/:organizationId/bank-rules')
@UseGuards(SessionGuard, OrganizationGuard)
export class BankRulesController {
  constructor(
    private readonly bankRules: BankRulesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('banking.rules.view')
  async list(@Req() request: OrganizationRequest) {
    return { data: await this.bankRules.list(request.organization.id) };
  }

  @Get(':bankRuleId')
  @RequirePermission('banking.rules.view')
  async detail(
    @Param('bankRuleId', new ParseUUIDPipe()) bankRuleId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.bankRules.detail(request.organization.id, bankRuleId) };
  }

  @Post()
  @RequirePermission('banking.rules.manage')
  async create(@Body() input: CreateBankRuleDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.bankRules.create(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':bankRuleId')
  @RequirePermission('banking.rules.manage')
  async update(
    @Param('bankRuleId', new ParseUUIDPipe()) bankRuleId: string,
    @Body() input: UpdateBankRuleDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.bankRules.update(
        request.organization,
        request.auth.user,
        bankRuleId,
        input,
        metadata,
      ),
    };
  }
}
