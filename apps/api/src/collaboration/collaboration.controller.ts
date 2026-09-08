import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
  type UploadedFileLike,
} from '../attachments/attachments.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { CollaborationCursorDto, CreateCommentDto } from './collaboration.dto.js';
import { CollaborationService } from './collaboration.service.js';

@Controller('organizations/:organizationId/collaboration/:targetType/:targetId')
@UseGuards(SessionGuard, OrganizationGuard)
export class CollaborationController {
  constructor(
    private readonly collaboration: CollaborationService,
    private readonly attachments: AttachmentsService,
    private readonly auth: AuthService,
  ) {}

  @Get('comments')
  async comments(
    @Param('targetType') type: string,
    @Param('targetId', new ParseUUIDPipe()) id: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.collaboration.listCommentsInternal(request.organization, type, id) };
  }

  @Post('comments')
  @HttpCode(201)
  @RequirePermission('collaboration.comments.create')
  async createComment(
    @Param('targetType') type: string,
    @Param('targetId', new ParseUUIDPipe()) id: string,
    @Body() input: CreateCommentDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.collaboration.addCommentInternal(
        request.organization,
        request.auth.user,
        type,
        id,
        input,
      ),
    };
  }

  @Get('attachments')
  async listAttachments(
    @Param('targetType') type: string,
    @Param('targetId', new ParseUUIDPipe()) id: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.collaboration.requireInternalTarget(request.organization, type, id, 'view');
    return { data: await this.attachments.list(request.organization.id, type as never, id) };
  }

  @Post('attachments')
  @HttpCode(201)
  @RequirePermission('collaboration.attachments.upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadAttachment(
    @Param('targetType') type: string,
    @Param('targetId', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: UploadedFileLike,
    @Req() request: OrganizationRequest,
  ) {
    if (!request.organization.permissions.has('collaboration.attachments.upload')) {
      throw new ForbiddenException('Your role does not allow uploading collaboration files.');
    }
    await this.collaboration.requireInternalTarget(request.organization, type, id, 'manage');
    return {
      data: await this.attachments.upload(
        request.organization,
        request.auth.user,
        type as never,
        id,
        file,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Get('attachments/:attachmentId/download')
  async downloadAttachment(
    @Param('targetType') type: string,
    @Param('targetId', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.collaboration.requireInternalTarget(request.organization, type, id, 'view');
    return {
      data: await this.attachments.download(
        request.organization.id,
        type as never,
        id,
        attachmentId,
      ),
    };
  }

  @Get('activity')
  async activity(
    @Param('targetType') type: string,
    @Param('targetId', new ParseUUIDPipe()) id: string,
    @Req() request: OrganizationRequest,
    @Query() query: CollaborationCursorDto,
  ) {
    return await this.collaboration.activity(request.organization, type, id, query.cursor);
  }
}
