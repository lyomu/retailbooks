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
  CreateRecurringInvoiceTemplateDto,
  ListRecurringInvoiceTemplatesQueryDto,
  UpdateRecurringInvoiceTemplateDto,
} from './recurring-invoices.dto.js';
import { RecurringInvoicesService } from './recurring-invoices.service.js';

@Controller('organizations/:organizationId/recurring-invoices')
@UseGuards(SessionGuard, OrganizationGuard)
export class RecurringInvoicesController {
  constructor(
    private readonly recurringInvoices: RecurringInvoicesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('sales.recurring_invoices.view')
  async list(
    @Query() query: ListRecurringInvoiceTemplatesQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.recurringInvoices.list(request.organization.id, query.active) };
  }

  @Get(':templateId')
  @RequirePermission('sales.recurring_invoices.view')
  async detail(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.recurringInvoices.detail(request.organization.id, templateId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('sales.recurring_invoices.manage')
  async create(
    @Body() input: CreateRecurringInvoiceTemplateDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringInvoices.createTemplate(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':templateId')
  @RequirePermission('sales.recurring_invoices.manage')
  async update(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() input: UpdateRecurringInvoiceTemplateDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringInvoices.updateTemplate(
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
  @RequirePermission('sales.recurring_invoices.manage')
  async deactivate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringInvoices.deactivate(
        request.organization,
        request.auth.user,
        templateId,
        metadata,
      ),
    };
  }

  @Post(':templateId/reactivate')
  @HttpCode(200)
  @RequirePermission('sales.recurring_invoices.manage')
  async reactivate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringInvoices.reactivate(
        request.organization,
        request.auth.user,
        templateId,
        metadata,
      ),
    };
  }

  @Post('run-due')
  @HttpCode(200)
  @RequirePermission('sales.recurring_invoices.manage')
  async runDue(@Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringInvoices.runDueTemplates(
        request.organization,
        request.auth.user,
        metadata,
      ),
    };
  }
}
