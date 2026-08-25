import {
  Body,
  Controller,
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
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import {
  AllocateCreditNoteDto,
  CreateCreditNoteDto,
  ListCreditNotesQueryDto,
  RefundCreditNoteDto,
  UpdateCreditNoteDto,
} from './credit-notes.dto.js';
import { CreditNotesService } from './credit-notes.service.js';

@Controller('organizations/:organizationId/credit-notes')
@UseGuards(SessionGuard, OrganizationGuard)
export class CreditNotesController {
  constructor(
    private readonly creditNotes: CreditNotesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('sales.credit_notes.view')
  async list(@Query() query: ListCreditNotesQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.creditNotes.list(request.organization.id, query.status) };
  }

  @Get(':creditNoteId')
  @RequirePermission('sales.credit_notes.view')
  async detail(
    @Param('creditNoteId', new ParseUUIDPipe()) creditNoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.creditNotes.detail(request.organization.id, creditNoteId) };
  }

  @Get(':creditNoteId/open-invoices')
  @RequirePermission('sales.credit_notes.view')
  async openInvoices(
    @Param('creditNoteId', new ParseUUIDPipe()) creditNoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.creditNotes.openInvoicesFor(request.organization.id, creditNoteId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('sales.credit_notes.manage')
  async create(@Body() input: CreateCreditNoteDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.creditNotes.createDraft(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':creditNoteId')
  @RequirePermission('sales.credit_notes.manage')
  async update(
    @Param('creditNoteId', new ParseUUIDPipe()) creditNoteId: string,
    @Body() input: UpdateCreditNoteDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.creditNotes.updateDraft(
        request.organization,
        request.auth.user,
        creditNoteId,
        input,
        metadata,
      ),
    };
  }

  @Post(':creditNoteId/issue')
  @HttpCode(200)
  @RequirePermission('sales.credit_notes.issue')
  async issue(
    @Param('creditNoteId', new ParseUUIDPipe()) creditNoteId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.creditNotes.issueCreditNote(
        request.organization,
        request.auth.user,
        creditNoteId,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':creditNoteId/void')
  @HttpCode(200)
  @RequirePermission('sales.credit_notes.void')
  async void(
    @Param('creditNoteId', new ParseUUIDPipe()) creditNoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.creditNotes.voidCreditNote(
        request.organization,
        request.auth.user,
        creditNoteId,
        metadata,
      ),
    };
  }

  @Post(':creditNoteId/allocate')
  @HttpCode(200)
  @RequirePermission('sales.credit_notes.allocate')
  async allocate(
    @Param('creditNoteId', new ParseUUIDPipe()) creditNoteId: string,
    @Body() input: AllocateCreditNoteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.creditNotes.allocate(
        request.organization,
        request.auth.user,
        creditNoteId,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':creditNoteId/refund')
  @HttpCode(200)
  @RequirePermission('sales.credit_notes.refund')
  async refund(
    @Param('creditNoteId', new ParseUUIDPipe()) creditNoteId: string,
    @Body() input: RefundCreditNoteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.creditNotes.refund(
        request.organization,
        request.auth.user,
        creditNoteId,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':creditNoteId/send')
  @HttpCode(200)
  @RequirePermission('sales.documents.send')
  async send(
    @Param('creditNoteId', new ParseUUIDPipe()) creditNoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.creditNotes.sendCreditNote(
        request.organization,
        request.auth.user,
        creditNoteId,
        metadata,
      ),
    };
  }
}
