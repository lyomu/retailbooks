import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { AutomationTasksService } from './automation-tasks.service.js';

@Controller('organizations/:organizationId/automation/tasks')
@UseGuards(SessionGuard, OrganizationGuard)
export class AutomationTasksController {
  constructor(
    private readonly tasks: AutomationTasksService,
    private readonly auth: AuthService,
  ) {}

  @Get('mine')
  @RequirePermission('automation.rules.view')
  async mine(
    @Query('includeCompleted') includeCompleted: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.tasks.listMine(
        request.organization.id,
        request.auth.user.id,
        includeCompleted === 'true',
      ),
    };
  }

  @Post(':taskId/complete')
  @HttpCode(200)
  @RequirePermission('automation.rules.view')
  async complete(
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.tasks.complete(
        request.organization,
        request.auth.user,
        taskId,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }
}
