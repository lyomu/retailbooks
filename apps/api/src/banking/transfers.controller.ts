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
import { CreateTransferDto, ListTransfersQueryDto } from './transfers.dto.js';
import { TransfersService } from './transfers.service.js';

@Controller('organizations/:organizationId/transfers')
@UseGuards(SessionGuard, OrganizationGuard)
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('banking.transfers.view')
  async list(@Query() query: ListTransfersQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.transfers.list(request.organization.id, query.financialAccountId) };
  }

  @Get(':transferId')
  @RequirePermission('banking.transfers.view')
  async detail(
    @Param('transferId', new ParseUUIDPipe()) transferId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.transfers.detail(request.organization.id, transferId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('banking.transfers.manage')
  async create(
    @Body() input: CreateTransferDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.transfers.create(
        request.organization,
        request.auth.user,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':transferId/void')
  @HttpCode(200)
  @RequirePermission('banking.transfers.manage')
  async void(
    @Param('transferId', new ParseUUIDPipe()) transferId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.transfers.void(
        request.organization,
        request.auth.user,
        transferId,
        metadata,
      ),
    };
  }
}
