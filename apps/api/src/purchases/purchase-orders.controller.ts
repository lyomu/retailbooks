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
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  RecordPurchaseOrderReceiptDto,
  UpdatePurchaseOrderDto,
} from './purchase-orders.dto.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';

@Controller('organizations/:organizationId/purchase-orders')
@UseGuards(SessionGuard, OrganizationGuard)
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('purchases.orders.view')
  async list(@Query() query: ListPurchaseOrdersQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.orders.list(request.organization.id, query.status) };
  }

  @Get(':orderId')
  @RequirePermission('purchases.orders.view')
  async detail(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.orders.detail(request.organization.id, orderId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('purchases.orders.manage')
  async create(@Body() input: CreatePurchaseOrderDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.createDraft(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':orderId')
  @RequirePermission('purchases.orders.manage')
  async update(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() input: UpdatePurchaseOrderDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.updateDraft(
        request.organization,
        request.auth.user,
        orderId,
        input,
        metadata,
      ),
    };
  }

  @Post(':orderId/approve')
  @HttpCode(200)
  @RequirePermission('purchases.orders.approve')
  async approve(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.approve(request.organization, request.auth.user, orderId, metadata),
    };
  }

  @Post(':orderId/issue')
  @HttpCode(200)
  @RequirePermission('purchases.orders.issue')
  async issue(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.issue(request.organization, request.auth.user, orderId, metadata),
    };
  }

  @Post(':orderId/receipt')
  @HttpCode(200)
  @RequirePermission('purchases.orders.manage')
  async recordReceipt(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() input: RecordPurchaseOrderReceiptDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.recordReceipt(
        request.organization,
        request.auth.user,
        orderId,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':orderId/close')
  @HttpCode(200)
  @RequirePermission('purchases.orders.manage')
  async close(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.close(request.organization, request.auth.user, orderId, metadata),
    };
  }

  @Post(':orderId/cancel')
  @HttpCode(200)
  @RequirePermission('purchases.orders.manage')
  async cancel(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.cancel(request.organization, request.auth.user, orderId, metadata),
    };
  }
}
