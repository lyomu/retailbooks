import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { ExpenseCategoriesService } from './expense-categories.service.js';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './expense-categories.dto.js';

@Controller('organizations/:organizationId/expense-categories')
@UseGuards(SessionGuard, OrganizationGuard)
export class ExpenseCategoriesController {
  constructor(
    private readonly categories: ExpenseCategoriesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('purchases.expense_categories.view')
  async list(@Req() request: OrganizationRequest) {
    return { data: await this.categories.list(request.organization.id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('purchases.expense_categories.manage')
  async create(@Body() input: CreateExpenseCategoryDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.categories.create(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':categoryId')
  @RequirePermission('purchases.expense_categories.manage')
  async update(
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Body() input: UpdateExpenseCategoryDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.categories.update(
        request.organization,
        request.auth.user,
        categoryId,
        input,
        metadata,
      ),
    };
  }
}
