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
import { CatalogService } from './catalog.service.js';
import {
  CreateCategoryDto,
  CreateItemDto,
  CreateUnitDto,
  ListItemsQueryDto,
  UpdateCategoryDto,
  UpdateItemDto,
  UpdateUnitDto,
} from './catalog.dto.js';

@Controller('organizations/:organizationId/catalog')
@UseGuards(SessionGuard, OrganizationGuard)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly auth: AuthService,
  ) {}

  @Get('units')
  @RequirePermission('catalog.view')
  async units(@Req() request: OrganizationRequest) {
    return { data: await this.catalog.listUnits(request.organization.id) };
  }

  @Post('units')
  @HttpCode(201)
  @RequirePermission('catalog.manage')
  async createUnit(@Body() input: CreateUnitDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.catalog.createUnit(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch('units/:unitId')
  @RequirePermission('catalog.manage')
  async updateUnit(
    @Param('unitId', new ParseUUIDPipe()) unitId: string,
    @Body() input: UpdateUnitDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.catalog.updateUnit(
        request.organization,
        request.auth.user,
        unitId,
        input,
        metadata,
      ),
    };
  }

  @Get('categories')
  @RequirePermission('catalog.view')
  async categories(@Req() request: OrganizationRequest) {
    return { data: await this.catalog.listCategories(request.organization.id) };
  }

  @Post('categories')
  @HttpCode(201)
  @RequirePermission('catalog.manage')
  async createCategory(@Body() input: CreateCategoryDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.catalog.createCategory(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch('categories/:categoryId')
  @RequirePermission('catalog.manage')
  async updateCategory(
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Body() input: UpdateCategoryDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.catalog.updateCategory(
        request.organization,
        request.auth.user,
        categoryId,
        input,
        metadata,
      ),
    };
  }

  @Get('items')
  @RequirePermission('catalog.view')
  async items(@Query() query: ListItemsQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.catalog.listItems(request.organization.id, query.status) };
  }

  @Get('items/:itemId')
  @RequirePermission('catalog.view')
  async itemDetail(
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.catalog.itemDetail(request.organization.id, itemId) };
  }

  @Post('items')
  @HttpCode(201)
  @RequirePermission('catalog.manage')
  async createItem(@Body() input: CreateItemDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.catalog.createItem(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch('items/:itemId')
  @RequirePermission('catalog.manage')
  async updateItem(
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() input: UpdateItemDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.catalog.updateItem(
        request.organization,
        request.auth.user,
        itemId,
        input,
        metadata,
      ),
    };
  }

  @Post('items/:itemId/deactivate')
  @HttpCode(200)
  @RequirePermission('catalog.manage')
  async deactivateItem(
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.catalog.setItemStatus(
        request.organization,
        request.auth.user,
        itemId,
        'INACTIVE',
        metadata,
      ),
    };
  }

  @Post('items/:itemId/reactivate')
  @HttpCode(200)
  @RequirePermission('catalog.manage')
  async reactivateItem(
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.catalog.setItemStatus(
        request.organization,
        request.auth.user,
        itemId,
        'ACTIVE',
        metadata,
      ),
    };
  }
}
