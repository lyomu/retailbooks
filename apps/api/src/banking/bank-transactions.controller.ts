import {
  Body,
  Controller,
  Get,
  Headers,
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
import { BankTransactionsService } from './bank-transactions.service.js';
import {
  CategorizeBankTransactionDto,
  ExcludeBankTransactionDto,
  ListBankTransactionsQueryDto,
  MatchBankTransactionDto,
} from './bank-transactions.dto.js';

@Controller('organizations/:organizationId/bank-transactions')
@UseGuards(SessionGuard, OrganizationGuard)
export class BankTransactionsController {
  constructor(
    private readonly transactions: BankTransactionsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('banking.transactions.view')
  async list(@Query() query: ListBankTransactionsQueryDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.transactions.list(
        request.organization.id,
        query.financialAccountId,
        query.disposition,
      ),
    };
  }

  @Get(':bankTransactionId')
  @RequirePermission('banking.transactions.view')
  async detail(
    @Param('bankTransactionId', new ParseUUIDPipe()) bankTransactionId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.transactions.detail(request.organization.id, bankTransactionId) };
  }

  @Post(':bankTransactionId/categorize')
  @HttpCode(200)
  @RequirePermission('banking.transactions.manage')
  async categorize(
    @Param('bankTransactionId', new ParseUUIDPipe()) bankTransactionId: string,
    @Body() input: CategorizeBankTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.transactions.categorize(
        request.organization,
        request.auth.user,
        bankTransactionId,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':bankTransactionId/exclude')
  @HttpCode(200)
  @RequirePermission('banking.transactions.manage')
  async exclude(
    @Param('bankTransactionId', new ParseUUIDPipe()) bankTransactionId: string,
    @Body() input: ExcludeBankTransactionDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.transactions.exclude(
        request.organization,
        request.auth.user,
        bankTransactionId,
        input.reason,
        metadata,
      ),
    };
  }

  @Post(':bankTransactionId/match')
  @HttpCode(200)
  @RequirePermission('banking.transactions.manage')
  async match(
    @Param('bankTransactionId', new ParseUUIDPipe()) bankTransactionId: string,
    @Body() input: MatchBankTransactionDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.transactions.match(
        request.organization,
        request.auth.user,
        bankTransactionId,
        input,
        metadata,
      ),
    };
  }

  @Post(':bankTransactionId/unmatch')
  @HttpCode(200)
  @RequirePermission('banking.transactions.manage')
  async unmatch(
    @Param('bankTransactionId', new ParseUUIDPipe()) bankTransactionId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.transactions.unmatch(
        request.organization,
        request.auth.user,
        bankTransactionId,
        metadata,
      ),
    };
  }
}
