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
import { RequirePermission, type OrganizationRequest } from './organization-context.js';
import { OrganizationGuard } from './organization.guard.js';
import {
  CreateOpeningBalanceBatchDto,
  ListOpeningBalanceBatchesQueryDto,
  OpeningBalanceTransitionDto,
  UpdateOpeningBalanceBatchDto,
} from './opening-balances.dto.js';
import { OpeningBalancesService } from './opening-balances.service.js';

/**
 * Reads fold under `accounts.view`; every state-changing action requires the reserved
 * `accounts.opening_balances.manage` key.
 */
@Controller('organizations/:organizationId/opening-balances')
@UseGuards(SessionGuard, OrganizationGuard)
export class OpeningBalancesController {
  constructor(
    private readonly openingBalances: OpeningBalancesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('accounts.view')
  list(@Query() query: ListOpeningBalanceBatchesQueryDto, @Req() request: OrganizationRequest) {
    return {
      data: this.openingBalances.list(request.organization.id, query.status),
    };
  }

  @Get(':batchId')
  @RequirePermission('accounts.view')
  async detail(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.openingBalances.detail(request.organization.id, batchId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('accounts.opening_balances.manage')
  async create(@Body() input: CreateOpeningBalanceBatchDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.openingBalances.createBatch(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':batchId')
  @RequirePermission('accounts.opening_balances.manage')
  async update(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Body() input: UpdateOpeningBalanceBatchDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.openingBalances.updateDraft(
        request.organization,
        request.auth.user,
        batchId,
        input,
        metadata,
      ),
    };
  }

  @Post(':batchId/validate')
  @HttpCode(200)
  @RequirePermission('accounts.opening_balances.manage')
  async validate(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.openingBalances.validate(
        request.organization,
        request.auth.user,
        batchId,
        metadata,
      ),
    };
  }

  @Post(':batchId/finalize')
  @HttpCode(200)
  @RequirePermission('accounts.opening_balances.manage')
  async finalize(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.openingBalances.finalize(
        request.organization,
        request.auth.user,
        batchId,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':batchId/void')
  @HttpCode(200)
  @RequirePermission('accounts.opening_balances.manage')
  async voidBatch(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Body() input: OpeningBalanceTransitionDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.openingBalances.voidBatch(
        request.organization,
        request.auth.user,
        batchId,
        input.reason,
        metadata,
      ),
    };
  }
}
