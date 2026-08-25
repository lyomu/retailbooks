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
  AllocateVendorCreditDto,
  CreateVendorCreditDto,
  ListVendorCreditsQueryDto,
  UpdateVendorCreditDto,
} from './vendor-credits.dto.js';
import { VendorCreditsService } from './vendor-credits.service.js';

@Controller('organizations/:organizationId/vendor-credits')
@UseGuards(SessionGuard, OrganizationGuard)
export class VendorCreditsController {
  constructor(
    private readonly vendorCredits: VendorCreditsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('purchases.vendor_credits.view')
  async list(@Query() query: ListVendorCreditsQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.vendorCredits.list(request.organization.id, query.status) };
  }

  @Get(':vendorCreditId')
  @RequirePermission('purchases.vendor_credits.view')
  async detail(
    @Param('vendorCreditId', new ParseUUIDPipe()) vendorCreditId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.vendorCredits.detail(request.organization.id, vendorCreditId) };
  }

  @Get(':vendorCreditId/open-bills')
  @RequirePermission('purchases.vendor_credits.view')
  async openBills(
    @Param('vendorCreditId', new ParseUUIDPipe()) vendorCreditId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.vendorCredits.openBillsFor(request.organization.id, vendorCreditId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('purchases.vendor_credits.manage')
  async create(@Body() input: CreateVendorCreditDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendorCredits.createDraft(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':vendorCreditId')
  @RequirePermission('purchases.vendor_credits.manage')
  async update(
    @Param('vendorCreditId', new ParseUUIDPipe()) vendorCreditId: string,
    @Body() input: UpdateVendorCreditDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendorCredits.updateDraft(
        request.organization,
        request.auth.user,
        vendorCreditId,
        input,
        metadata,
      ),
    };
  }

  @Post(':vendorCreditId/issue')
  @HttpCode(200)
  @RequirePermission('purchases.vendor_credits.issue')
  async issue(
    @Param('vendorCreditId', new ParseUUIDPipe()) vendorCreditId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendorCredits.issueVendorCredit(
        request.organization,
        request.auth.user,
        vendorCreditId,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':vendorCreditId/void')
  @HttpCode(200)
  @RequirePermission('purchases.vendor_credits.void')
  async void(
    @Param('vendorCreditId', new ParseUUIDPipe()) vendorCreditId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendorCredits.voidVendorCredit(
        request.organization,
        request.auth.user,
        vendorCreditId,
        metadata,
      ),
    };
  }

  @Post(':vendorCreditId/allocate')
  @HttpCode(200)
  @RequirePermission('purchases.vendor_credits.allocate')
  async allocate(
    @Param('vendorCreditId', new ParseUUIDPipe()) vendorCreditId: string,
    @Body() input: AllocateVendorCreditDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendorCredits.allocate(
        request.organization,
        request.auth.user,
        vendorCreditId,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }
}
