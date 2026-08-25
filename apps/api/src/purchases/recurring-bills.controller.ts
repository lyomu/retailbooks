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
  CreateRecurringBillTemplateDto,
  ListRecurringBillTemplatesQueryDto,
  UpdateRecurringBillTemplateDto,
} from './recurring-bills.dto.js';
import { RecurringBillsService } from './recurring-bills.service.js';

@Controller('organizations/:organizationId/recurring-bills')
@UseGuards(SessionGuard, OrganizationGuard)
export class RecurringBillsController {
  constructor(
    private readonly recurringBills: RecurringBillsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('purchases.recurring_bills.view')
  async list(
    @Query() query: ListRecurringBillTemplatesQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.recurringBills.list(request.organization.id, query.active) };
  }

  @Get(':templateId')
  @RequirePermission('purchases.recurring_bills.view')
  async detail(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.recurringBills.detail(request.organization.id, templateId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('purchases.recurring_bills.manage')
  async create(@Body() input: CreateRecurringBillTemplateDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringBills.createTemplate(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':templateId')
  @RequirePermission('purchases.recurring_bills.manage')
  async update(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() input: UpdateRecurringBillTemplateDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringBills.updateTemplate(
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
  @RequirePermission('purchases.recurring_bills.manage')
  async deactivate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringBills.deactivate(
        request.organization,
        request.auth.user,
        templateId,
        metadata,
      ),
    };
  }

  @Post(':templateId/reactivate')
  @HttpCode(200)
  @RequirePermission('purchases.recurring_bills.manage')
  async reactivate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringBills.reactivate(
        request.organization,
        request.auth.user,
        templateId,
        metadata,
      ),
    };
  }

  @Post('run-due')
  @HttpCode(200)
  @RequirePermission('purchases.recurring_bills.manage')
  async runDue(@Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringBills.runDueTemplates(
        request.organization,
        request.auth.user,
        metadata,
      ),
    };
  }
}
