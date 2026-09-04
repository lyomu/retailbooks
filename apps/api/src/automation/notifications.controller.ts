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

import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { NotificationPreferenceDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@Controller('organizations/:organizationId/notifications')
@UseGuards(SessionGuard, OrganizationGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('notifications.view')
  async list(
    @Query('unreadOnly') unreadOnly: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.notifications.list(
        request.organization.id,
        request.auth.user.id,
        unreadOnly === 'true',
      ),
    };
  }

  @Get('unread-count')
  @RequirePermission('notifications.view')
  async unreadCount(@Req() request: OrganizationRequest) {
    return {
      data: {
        count: await this.notifications.unreadCount(request.organization.id, request.auth.user.id),
      },
    };
  }

  @Get('preferences')
  @RequirePermission('notifications.view')
  async preferences(@Req() request: OrganizationRequest) {
    return {
      data: await this.notifications.preferences(request.organization.id, request.auth.user.id),
    };
  }

  @Patch('preferences')
  @RequirePermission('notifications.manage')
  async preference(@Body() input: NotificationPreferenceDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.notifications.upsertPreference(
        request.organization.id,
        request.auth.user.id,
        input.eventKey,
        input.inAppEnabled ?? true,
        input.emailEnabled ?? true,
      ),
    };
  }

  @Post(':notificationId/read')
  @HttpCode(204)
  @RequirePermission('notifications.view')
  async read(
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.notifications.markRead(
      request.organization.id,
      request.auth.user.id,
      notificationId,
    );
  }

  @Post('read-all')
  @HttpCode(204)
  @RequirePermission('notifications.view')
  async readAll(@Req() request: OrganizationRequest) {
    await this.notifications.markAllRead(request.organization.id, request.auth.user.id);
  }
}
