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
import {
  AllocatePaymentMadeDto,
  CreatePaymentMadeDto,
  ListPaymentsMadeQueryDto,
} from './payments-made.dto.js';
import { PaymentsMadeService } from './payments-made.service.js';

@Controller('organizations/:organizationId/payments-made')
@UseGuards(SessionGuard, OrganizationGuard)
export class PaymentsMadeController {
  constructor(
    private readonly payments: PaymentsMadeService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('purchases.payments_made.view')
  async list(@Query() query: ListPaymentsMadeQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.payments.list(request.organization.id, query.status) };
  }

  @Get(':paymentId')
  @RequirePermission('purchases.payments_made.view')
  async detail(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.payments.detail(request.organization.id, paymentId) };
  }

  @Get(':paymentId/open-bills')
  @RequirePermission('purchases.payments_made.view')
  async openBills(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.payments.openBillsFor(request.organization.id, paymentId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('purchases.payments_made.record')
  async record(
    @Body() input: CreatePaymentMadeDto,
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
  @RequirePermission('purchases.payments_made.allocate')
  async allocate(
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Body() input: AllocatePaymentMadeDto,
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
