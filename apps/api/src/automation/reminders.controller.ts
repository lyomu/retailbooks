import {
  Body,
  Controller,
  Get,
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
import {
  CreateReminderPolicyDto,
  ReminderPolicyActiveDto,
  UpdateReminderPolicyDto,
} from './reminders.dto.js';
import { RemindersService } from './reminders.service.js';

@Controller('organizations/:organizationId/automation/reminder-policies')
@UseGuards(SessionGuard, OrganizationGuard)
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('automation.schedules.view')
  async list(@Req() request: OrganizationRequest) {
    return { data: await this.reminders.list(request.organization.id) };
  }

  @Post()
  @RequirePermission('automation.schedules.manage')
  async create(@Body() input: CreateReminderPolicyDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.reminders.create(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch(':policyId')
  @RequirePermission('automation.schedules.manage')
  async update(
    @Param('policyId', new ParseUUIDPipe()) policyId: string,
    @Body() input: UpdateReminderPolicyDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.reminders.update(
        request.organization,
        request.auth.user,
        policyId,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch(':policyId/active')
  @RequirePermission('automation.schedules.manage')
  async active(
    @Param('policyId', new ParseUUIDPipe()) policyId: string,
    @Body() input: ReminderPolicyActiveDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.reminders.setActive(
        request.organization,
        request.auth.user,
        policyId,
        input.active,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }
}
