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
import { AllocatePaymentDto, CreatePaymentDto, ListPaymentsQueryDto } from './payments.dto.js';
import { PaymentsService } from './payments.service.js';

@Controller('organizations/:organizationId/payments')
@UseGuards(SessionGuard, OrganizationGuard)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('sales.payments.view')
  async list(@Query() query: ListPaymentsQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.payments.list(request.organization.id, query.status) };
  }

  @Get(':paymentId')
  @RequirePermission('sales.payments.view')
  async detail(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.payments.detail(request.organization.id, paymentId) };
  }

  @Get(':paymentId/open-invoices')
  @RequirePermission('sales.payments.view')
  async openInvoices(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.payments.openInvoicesFor(request.organization.id, paymentId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('sales.payments.record')
  async record(
    @Body() input: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.payments.record(
        request.organization,
        request.auth.user,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':paymentId/allocate')
  @HttpCode(200)
  @RequirePermission('sales.payments.allocate')
  async allocate(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Body() input: AllocatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.payments.allocate(
        request.organization,
        request.auth.user,
        paymentId,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }
}
