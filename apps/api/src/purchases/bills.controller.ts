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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
  type UploadedFileLike,
} from '../attachments/attachments.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { BillsService } from './bills.service.js';
import { CreateBillDto, ListBillsQueryDto, UpdateBillDto } from './bills.dto.js';

@Controller('organizations/:organizationId/bills')
@UseGuards(SessionGuard, OrganizationGuard)
export class BillsController {
  constructor(
    private readonly bills: BillsService,
    private readonly attachments: AttachmentsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('purchases.bills.view')
  async list(@Query() query: ListBillsQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.bills.list(request.organization.id, query.status) };
  }

  @Get(':billId')
  @RequirePermission('purchases.bills.view')
  async detail(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.bills.detail(request.organization.id, billId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('purchases.bills.manage')
  async create(@Body() input: CreateBillDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.bills.createDraft(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':billId')
  @RequirePermission('purchases.bills.manage')
  async update(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Body() input: UpdateBillDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.bills.updateDraft(
        request.organization,
        request.auth.user,
        billId,
        input,
        metadata,
      ),
    };
  }

  @Post(':billId/issue')
  @HttpCode(200)
  @RequirePermission('purchases.bills.issue')
  async issue(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.bills.issueBill(
        request.organization,
        request.auth.user,
        billId,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':billId/void')
  @HttpCode(200)
  @RequirePermission('purchases.bills.void')
  async void(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.bills.voidBill(request.organization, request.auth.user, billId, metadata),
    };
  }

  @Get(':billId/attachments')
  @RequirePermission('purchases.bills.view')
  async listAttachments(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.attachments.list(request.organization.id, 'BILL', billId) };
  }

  /**
   * Phase 11 stopped putting a signed URL on every listed attachment: a listing is not an
   * authorization to fetch bytes. This endpoint re-checks access and issues the short-lived link.
   */
  @Get(':billId/attachments/:attachmentId/download')
  @RequirePermission('purchases.bills.view')
  async downloadAttachment(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.attachments.download(request.organization.id, 'BILL', billId, attachmentId),
    };
  }

  @Post(':billId/attachments')
  @HttpCode(201)
  @RequirePermission('purchases.bills.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadAttachment(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @UploadedFile() file: UploadedFileLike,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.attachments.upload(
        request.organization,
        request.auth.user,
        'BILL',
        billId,
        file,
        metadata,
      ),
    };
  }
}
