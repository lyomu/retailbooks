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
import { RequirePermission, type OrganizationRequest } from './organization-context.js';
import { OrganizationGuard } from './organization.guard.js';
import {
  CreateRecurringJournalTemplateDto,
  UpdateRecurringJournalTemplateDto,
} from './recurring-journals.dto.js';
import { RecurringJournalsService } from './recurring-journals.service.js';

@Controller('organizations/:organizationId/recurring-journals')
@UseGuards(SessionGuard, OrganizationGuard)
export class RecurringJournalsController {
  constructor(
    private readonly recurringJournals: RecurringJournalsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('journals.recurring.view')
  list(@Query('active') active: string | undefined, @Req() request: OrganizationRequest) {
    return { data: this.recurringJournals.list(request.organization.id, active) };
  }

  @Get(':templateId')
  @RequirePermission('journals.recurring.view')
  async detail(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.recurringJournals.detail(request.organization.id, templateId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('journals.recurring.manage')
  async create(
    @Body() input: CreateRecurringJournalTemplateDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringJournals.createTemplate(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':templateId')
  @RequirePermission('journals.recurring.manage')
  async update(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() input: UpdateRecurringJournalTemplateDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringJournals.updateTemplate(
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
  @RequirePermission('journals.recurring.manage')
  async deactivate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringJournals.deactivate(
        request.organization,
        request.auth.user,
        templateId,
        metadata,
      ),
    };
  }

  @Post(':templateId/reactivate')
  @HttpCode(200)
  @RequirePermission('journals.recurring.manage')
  async reactivate(
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringJournals.reactivate(
        request.organization,
        request.auth.user,
        templateId,
        metadata,
      ),
    };
  }

  @Post('run-due')
  @HttpCode(200)
  @RequirePermission('journals.recurring.manage')
  async runDue(@Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.recurringJournals.runDueTemplates(
        request.organization,
        request.auth.user,
        metadata,
      ),
    };
  }
}
