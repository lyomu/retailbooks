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
import { CustomersService } from './customers.service.js';
import { CreateContactDto, ListContactsQueryDto, UpdateContactDto } from './customers.dto.js';

@Controller('organizations/:organizationId/customers')
@UseGuards(SessionGuard, OrganizationGuard)
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('customers.view')
  async list(@Query() query: ListContactsQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.customers.list(request.organization.id, query.status) };
  }

  @Get(':contactId')
  @RequirePermission('customers.view')
  async detail(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.customers.detail(request.organization.id, contactId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('customers.manage')
  async create(@Body() input: CreateContactDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.customers.create(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':contactId')
  @RequirePermission('customers.manage')
  async update(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Body() input: UpdateContactDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.customers.update(
        request.organization,
        request.auth.user,
        contactId,
        input,
        metadata,
      ),
    };
  }

  @Post(':contactId/deactivate')
  @HttpCode(200)
  @RequirePermission('customers.manage')
  async deactivate(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.customers.setStatus(
        request.organization,
        request.auth.user,
        contactId,
        'INACTIVE',
        metadata,
      ),
    };
  }

  @Post(':contactId/reactivate')
  @HttpCode(200)
  @RequirePermission('customers.manage')
  async reactivate(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.customers.setStatus(
        request.organization,
        request.auth.user,
        contactId,
        'ACTIVE',
        metadata,
      ),
    };
  }
}
