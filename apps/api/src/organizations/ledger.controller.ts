import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
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
  AccountLedgerQueryDto,
  CreateAccountDto,
  JournalQueryDto,
  ReversalDto,
  TrialBalanceQueryDto,
  UpdateAccountDto,
  UpsertJournalDto,
} from './ledger.dto.js';
import { LedgerService } from './ledger.service.js';
import { RequirePermission, type OrganizationRequest } from './organization-context.js';
import { OrganizationGuard } from './organization.guard.js';

@Controller('organizations/:organizationId')
@UseGuards(SessionGuard, OrganizationGuard)
export class LedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly auth: AuthService,
  ) {}

  @Get('accounts')
  @RequirePermission('accounts.view')
  async accounts(@Req() request: OrganizationRequest) {
    return { data: await this.ledger.listAccounts(request.organization.id) };
  }

  @Post('accounts')
  @HttpCode(201)
  @RequirePermission('accounts.create')
  async createAccount(@Body() input: CreateAccountDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.ledger.createAccount(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch('accounts/:accountId')
  @RequirePermission('accounts.update')
  async updateAccount(
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Body() input: UpdateAccountDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.ledger.updateAccount(
        request.organization,
        request.auth.user,
        accountId,
        input,
        metadata,
      ),
    };
  }

  @Delete('accounts/:accountId')
  @HttpCode(204)
  @RequirePermission('accounts.deactivate')
  async archiveAccount(
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.ledger.archiveAccount(request.organization, request.auth.user, accountId, metadata);
  }

  @Get('accounts/:accountId/ledger')
  @RequirePermission('reports.view')
  async accountLedger(
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Query() query: AccountLedgerQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.ledger.accountLedger(request.organization.id, accountId, query) };
  }

  @Get('journals')
  @RequirePermission('journals.view')
  async journals(@Query() query: JournalQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.ledger.listJournals(request.organization.id, query) };
  }

  @Post('journals')
  @HttpCode(201)
  @RequirePermission('journals.create')
  async createJournal(@Body() input: UpsertJournalDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.ledger.createJournalDraft(request.organization, request.auth.user, input),
    };
  }

  @Get('journals/:journalId')
  @RequirePermission('journals.view')
  async journal(
    @Param('journalId', new ParseUUIDPipe()) journalId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.ledger.getJournal(request.organization.id, journalId) };
  }

  @Patch('journals/:journalId')
  @RequirePermission('journals.create')
  async updateJournal(
    @Param('journalId', new ParseUUIDPipe()) journalId: string,
    @Body() input: UpsertJournalDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.ledger.updateJournalDraft(request.organization, journalId, input),
    };
  }

  @Delete('journals/:journalId')
  @HttpCode(204)
  @RequirePermission('journals.create')
  async deleteJournal(
    @Param('journalId', new ParseUUIDPipe()) journalId: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.ledger.deleteJournalDraft(request.organization.id, journalId);
  }

  @Post('journals/:journalId/post')
  @HttpCode(200)
  @RequirePermission('journals.post')
  async postJournal(
    @Param('journalId', new ParseUUIDPipe()) journalId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.ledger.postJournal(
        request.organization,
        request.auth.user,
        journalId,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post('journals/:journalId/reverse')
  @HttpCode(200)
  @RequirePermission('journals.reverse')
  async reverseJournal(
    @Param('journalId', new ParseUUIDPipe()) journalId: string,
    @Body() input: ReversalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.ledger.reverseJournal(
        request.organization,
        request.auth.user,
        journalId,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Get('reports/trial-balance')
  @RequirePermission('reports.view')
  async trialBalance(@Query() query: TrialBalanceQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.ledger.trialBalance(request.organization.id, query) };
  }
}
