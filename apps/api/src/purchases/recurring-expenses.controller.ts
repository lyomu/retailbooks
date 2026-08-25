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
  CreateRecurringExpenseTemplateDto,
  ListRecurringExpenseTemplatesQueryDto,
  UpdateRecurringExpenseTemplateDto,
} from './recurring-expenses.dto.js';
import { RecurringExpensesService } from './recurring-expenses.service.js';

@Controller('organizations/:organizationId/recurring-expenses')
@UseGuards(SessionGuard, OrganizationGuard)
export class RecurringExpensesController {
  constructor(
    private readonly recurringExpenses: RecurringExpensesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('purchases.recurring_expenses.view')
  async list(
    @Query() query: ListRecurringExpenseTemplatesQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.recurringExpenses.list(request.organization.id, query.active) };
  }

  @Get(':templateId')
  @RequirePermission('purchases.recurring_expenses.view')
  async detail(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.recurringExpenses.detail(request.organization.id, templateId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('purchases.recurring_expenses.manage')
  async create(
    @Body() input: CreateRecurringExpenseTemplateDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringExpenses.createTemplate(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':templateId')
  @RequirePermission('purchases.recurring_expenses.manage')
  async update(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() input: UpdateRecurringExpenseTemplateDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringExpenses.updateTemplate(
        request.organization,
        request.auth.user,
        templateId,
        input,
        metadata,
      ),
    };
  }

  @Post(':templateId/deactivate')
  @HttpCode(200)
  @RequirePermission('purchases.recurring_expenses.manage')
  async deactivate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringExpenses.deactivate(
        request.organization,
        request.auth.user,
        templateId,
        metadata,
      ),
    };
  }

  @Post(':templateId/reactivate')
  @HttpCode(200)
  @RequirePermission('purchases.recurring_expenses.manage')
  async reactivate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringExpenses.reactivate(
        request.organization,
        request.auth.user,
        templateId,
        metadata,
      ),
    };
  }

  @Post('run-due')
  @HttpCode(200)
  @RequirePermission('purchases.recurring_expenses.manage')
  async runDue(@Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringExpenses.runDueTemplates(
        request.organization,
        request.auth.user,
        metadata,
      ),
    };
  }
}
