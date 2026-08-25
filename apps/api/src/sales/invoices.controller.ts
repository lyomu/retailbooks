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
import { CreateInvoiceDto, ListInvoicesQueryDto, UpdateInvoiceDto } from './invoices.dto.js';
import { InvoicesService } from './invoices.service.js';

@Controller('organizations/:organizationId/invoices')
@UseGuards(SessionGuard, OrganizationGuard)
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('sales.invoices.view')
  async list(@Query() query: ListInvoicesQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.invoices.list(request.organization.id, query.status) };
  }

  @Get(':invoiceId')
  @RequirePermission('sales.invoices.view')
  async detail(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.invoices.detail(request.organization.id, invoiceId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('sales.invoices.manage')
  async create(@Body() input: CreateInvoiceDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.invoices.createDraft(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':invoiceId')
  @RequirePermission('sales.invoices.manage')
  async update(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() input: UpdateInvoiceDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.invoices.updateDraft(
        request.organization,
        request.auth.user,
        invoiceId,
        input,
        metadata,
      ),
    };
  }

  @Post(':invoiceId/issue')
  @HttpCode(200)
  @RequirePermission('sales.invoices.issue')
  async issue(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.invoices.issueInvoice(
        request.organization,
        request.auth.user,
        invoiceId,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':invoiceId/void')
  @HttpCode(200)
  @RequirePermission('sales.invoices.void')
  async void(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.invoices.voidInvoice(
        request.organization,
        request.auth.user,
        invoiceId,
        metadata,
      ),
    };
  }

  @Post(':invoiceId/send')
  @HttpCode(200)
  @RequirePermission('sales.documents.send')
  async send(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.invoices.sendInvoice(
        request.organization,
        request.auth.user,
        invoiceId,
        metadata,
      ),
    };
  }
}
