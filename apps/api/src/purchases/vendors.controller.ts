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
import { VendorsService } from './vendors.service.js';
import { CreateVendorDto, ListVendorsQueryDto, UpdateVendorDto } from './vendors.dto.js';

@Controller('organizations/:organizationId/vendors')
@UseGuards(SessionGuard, OrganizationGuard)
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('vendors.view')
  async list(@Query() query: ListVendorsQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.vendors.list(request.organization.id, query.status) };
  }

  @Get('check-duplicate')
  @RequirePermission('vendors.manage')
  async checkDuplicate(
    @Query('displayName') displayName: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: {
        matches: await this.vendors.checkDuplicate(request.organization.id, displayName ?? ''),
      },
    };
  }

  @Get(':vendorId')
  @RequirePermission('vendors.view')
  async detail(
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.vendors.detail(request.organization.id, vendorId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('vendors.manage')
  async create(@Body() input: CreateVendorDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendors.create(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':vendorId')
  @RequirePermission('vendors.manage')
  async update(
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Body() input: UpdateVendorDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendors.update(
        request.organization,
        request.auth.user,
        vendorId,
        input,
        metadata,
      ),
    };
  }

  @Post(':vendorId/deactivate')
  @HttpCode(200)
  @RequirePermission('vendors.manage')
  async deactivate(
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendors.setStatus(
        request.organization,
        request.auth.user,
        vendorId,
        'INACTIVE',
        metadata,
      ),
    };
  }

  @Post(':vendorId/reactivate')
  @HttpCode(200)
  @RequirePermission('vendors.manage')
  async reactivate(
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.vendors.setStatus(
        request.organization,
        request.auth.user,
        vendorId,
        'ACTIVE',
        metadata,
      ),
    };
  }
}
