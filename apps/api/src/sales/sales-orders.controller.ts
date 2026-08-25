import {
  Body,
  Controller,
  Get,
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
  CreateSalesOrderDto,
  ListSalesOrdersQueryDto,
  UpdateSalesOrderDto,
} from './sales-orders.dto.js';
import { SalesOrdersService } from './sales-orders.service.js';

@Controller('organizations/:organizationId/sales-orders')
@UseGuards(SessionGuard, OrganizationGuard)
export class SalesOrdersController {
  constructor(
    private readonly orders: SalesOrdersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('sales.orders.view')
  async list(@Query() query: ListSalesOrdersQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.orders.list(request.organization.id, query.status) };
  }

  @Get(':orderId')
  @RequirePermission('sales.orders.view')
  async detail(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.orders.detail(request.organization.id, orderId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('sales.orders.manage')
  async create(@Body() input: CreateSalesOrderDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.createDraft(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':orderId')
  @RequirePermission('sales.orders.manage')
  async update(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() input: UpdateSalesOrderDto,
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
  @RequirePermission('sales.orders.approve')
  async approve(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.approve(request.organization, request.auth.user, orderId, metadata),
    };
  }

  @Post(':orderId/confirm')
  @HttpCode(200)
  @RequirePermission('sales.orders.manage')
  async confirm(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.confirm(request.organization, request.auth.user, orderId, metadata),
    };
  }

  @Post(':orderId/partially-fulfill')
  @HttpCode(200)
  @RequirePermission('sales.orders.manage')
  async partiallyFulfill(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.markPartiallyFulfilled(
        request.organization,
        request.auth.user,
        orderId,
        metadata,
      ),
    };
  }

  @Post(':orderId/fulfill')
  @HttpCode(200)
  @RequirePermission('sales.orders.manage')
  async fulfill(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.markFulfilled(
        request.organization,
        request.auth.user,
        orderId,
        metadata,
      ),
    };
  }

  @Post(':orderId/cancel')
  @HttpCode(200)
  @RequirePermission('sales.orders.manage')
  async cancel(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.cancel(request.organization, request.auth.user, orderId, metadata),
    };
  }

  @Post(':orderId/convert')
  @HttpCode(200)
  @RequirePermission('sales.orders.convert')
  async convert(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.orders.convertToInvoice(
        request.organization,
        request.auth.user,
        orderId,
        metadata,
      ),
    };
  }
}
