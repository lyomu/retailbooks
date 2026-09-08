import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CollaborationService } from '../collaboration/collaboration.service.js';
import { CreateCommentDto } from '../collaboration/collaboration.dto.js';
import {
  RequirePermission,
  type OrganizationContext,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { PortalAccessGuard } from './portal-access.guard.js';
import type { PortalRequest } from './portal-context.js';
import {
  CreatePortalInvitationDto,
  PortalInvitationTokenDto,
  UpdatePortalProfileDto,
} from './portal.dto.js';
import { PortalsService } from './portals.service.js';

@Controller('organizations/:organizationId')
@UseGuards(SessionGuard, OrganizationGuard)
export class InternalPortalsController {
  constructor(private readonly portals: PortalsService) {}

  @Get('customers/:contactId/portal-users')
  @RequirePermission('portal.access.manage')
  async list(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.portals.listInternal(request.organization.id, contactId) };
  }

  @Post('customers/:contactId/portal-invitations')
  @RequirePermission('portal.access.manage')
  async invite(
    @Param('contactId', new ParseUUIDPipe()) contactId: string,
    @Body() input: CreatePortalInvitationDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.portals.invite(
        request.organization,
        request.auth.user,
        contactId,
        input.email,
      ),
    };
  }

  @Post('portal-invitations/:invitationId/resend')
  @RequirePermission('portal.access.manage')
  async resend(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.portals.resend(request.organization, request.auth.user, invitationId),
    };
  }

  @Delete('portal-invitations/:invitationId')
  @HttpCode(204)
  @RequirePermission('portal.access.manage')
  async revokeInvitation(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.portals.revokeInvitation(request.organization.id, invitationId);
  }

  @Delete('portal-users/:portalUserId')
  @HttpCode(204)
  @RequirePermission('portal.access.manage')
  async revokeUser(
    @Param('portalUserId', new ParseUUIDPipe()) portalUserId: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.portals.revokeUser(request.organization.id, portalUserId);
  }
}

@Controller('portal-invitations')
export class PortalInvitationsController {
  constructor(
    private readonly portals: PortalsService,
    private readonly limits: AuthRateLimitService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  async preview(@Body() input: PortalInvitationTokenDto) {
    await this.limits.consume(`portal:invite-preview:${input.token.slice(0, 16)}`, 10, 60);
    return { data: await this.portals.preview(input.token) };
  }

  @Post('accept')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async accept(@Body() input: PortalInvitationTokenDto, @Req() request: any) {
    await this.limits.consume(`portal:invite-accept:${request.auth.user.id}`, 10, 60);
    return { data: await this.portals.accept(input.token, request.auth.user) };
  }
}

@Controller('portal/accounts')
@UseGuards(SessionGuard)
export class PortalAccountsController {
  constructor(
    private readonly portals: PortalsService,
    private readonly auth: AuthService,
    private readonly collaboration: CollaborationService,
    private readonly attachments: AttachmentsService,
    private readonly limits: AuthRateLimitService,
  ) {}

  @Get()
  async accounts(@Req() request: any) {
    return { data: await this.portals.accounts(request.auth.user.id) };
  }

  @Get(':portalUserId/overview')
  @UseGuards(PortalAccessGuard)
  async overview(@Req() request: PortalRequest) {
    return {
      data: { account: request.portal, documents: await this.portals.documents(request.portal) },
    };
  }

  @Get(':portalUserId/documents')
  @UseGuards(PortalAccessGuard)
  async documents(
    @Param('portalUserId', new ParseUUIDPipe()) _id: string,
    @Req() request: PortalRequest,
  ) {
    return { data: await this.portals.documents(request.portal) };
  }

  @Get(':portalUserId/documents/:documentType/:documentId')
  @UseGuards(PortalAccessGuard)
  async document(
    @Param('documentType') documentType: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Req() request: PortalRequest,
  ) {
    return { data: await this.portals.document(request.portal, documentType, documentId) };
  }

  @Get(':portalUserId/documents/:documentType/:documentId/download')
  @UseGuards(PortalAccessGuard)
  async documentDownload(
    @Param('documentType') type: string,
    @Param('documentId', new ParseUUIDPipe()) id: string,
    @Req() request: PortalRequest,
  ) {
    await this.limits.consume(`portal:download:${request.portal.id}`, 60, 60);
    return { data: await this.portals.downloadDocument(request.portal, type, id) };
  }

  @Get(':portalUserId/documents/:documentType/:documentId/comments')
  @UseGuards(PortalAccessGuard)
  async comments(
    @Param('documentType') type: string,
    @Param('documentId', new ParseUUIDPipe()) id: string,
    @Req() request: PortalRequest,
  ) {
    return { data: await this.collaboration.listCommentsPortal(request.portal, type, id) };
  }

  @Post(':portalUserId/documents/:documentType/:documentId/comments')
  @UseGuards(PortalAccessGuard)
  async createComment(
    @Param('documentType') type: string,
    @Param('documentId', new ParseUUIDPipe()) id: string,
    @Body() input: CreateCommentDto,
    @Req() request: PortalRequest,
  ) {
    return { data: await this.collaboration.addCommentPortal(request.portal, type, id, input) };
  }

  @Get(':portalUserId/documents/:documentType/:documentId/attachments')
  @UseGuards(PortalAccessGuard)
  async attachmentsList(
    @Param('documentType') type: string,
    @Param('documentId', new ParseUUIDPipe()) id: string,
    @Req() request: PortalRequest,
  ) {
    await this.collaboration.listCommentsPortal(request.portal, type, id);
    return {
      data: await this.attachments.listCustomer(request.portal.organizationId, type as never, id),
    };
  }

  @Post(':portalUserId/documents/:documentType/:documentId/attachments')
  @UseGuards(PortalAccessGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadAttachment(
    @Param('documentType') type: string,
    @Param('documentId', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: UploadedFileLike,
    @Req() request: PortalRequest,
  ) {
    await this.limits.consume(`portal:upload:${request.portal.id}`, 20, 60);
    await this.collaboration.listCommentsPortal(request.portal, type, id);
    return {
      data: await this.attachments.upload(
        { id: request.portal.organizationId } as OrganizationContext,
        request.auth.user,
        type as never,
        id,
        file,
        requestMetadata(request, this.auth.pepper),
        { portalUserId: request.portal.id },
      ),
    };
  }

  @Get(':portalUserId/documents/:documentType/:documentId/attachments/:attachmentId/download')
  @UseGuards(PortalAccessGuard)
  async attachmentDownload(
    @Param('documentType') type: string,
    @Param('documentId', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() request: PortalRequest,
  ) {
    await this.limits.consume(`portal:download:${request.portal.id}`, 60, 60);
    await this.collaboration.listCommentsPortal(request.portal, type, id);
    return {
      data: await this.attachments.downloadCustomer(
        request.portal.organizationId,
        type as never,
        id,
        attachmentId,
      ),
    };
  }

  @Get(':portalUserId/statement')
  @UseGuards(PortalAccessGuard)
  async statement(@Query() query: { from?: string; to?: string }, @Req() request: PortalRequest) {
    return { data: await this.portals.statement(request.portal, query) };
  }

  @Post(':portalUserId/quotes/:quoteId/accept')
  @UseGuards(PortalAccessGuard)
  async acceptQuote(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: PortalRequest,
  ) {
    return { data: await this.portals.decideQuote(request.portal, quoteId, 'ACCEPTED') };
  }

  @Post(':portalUserId/quotes/:quoteId/decline')
  @UseGuards(PortalAccessGuard)
  async declineQuote(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: PortalRequest,
  ) {
    return { data: await this.portals.decideQuote(request.portal, quoteId, 'DECLINED') };
  }

  @Patch(':portalUserId/profile')
  @UseGuards(PortalAccessGuard)
  async profile(@Body() input: UpdatePortalProfileDto, @Req() request: PortalRequest) {
    return { data: await this.portals.updateProfile(request.portal, input) };
  }
}
