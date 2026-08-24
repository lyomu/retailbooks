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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { getCookie, requestMetadata } from '../auth/request-context.js';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard.js';
import { DocumentNumberingService } from './document-numbering.service.js';
import { FiscalPeriodsService } from './fiscal-periods.service.js';
import { referenceData } from './jurisdiction-catalog.js';
import { OrganizationMembersService } from './organization-members.service.js';
import { RequirePermission, type OrganizationRequest } from './organization-context.js';
import { ACTIVE_ORGANIZATION_COOKIE, setActiveOrganizationCookie } from './organization-cookie.js';
import {
  CreateOrganizationDto,
  GenerateFiscalYearDto,
  InvitationTokenDto,
  InviteMemberDto,
  PeriodTransitionDto,
  UpdateJournalNumberingDto,
  UpdateMemberDto,
  UpdateOrganizationDto,
  UpdateRolePermissionsDto,
} from './organization.dto.js';
import { OrganizationGuard } from './organization.guard.js';
import { OrganizationService } from './organization.service.js';
import { PermissionsService } from './permissions.service.js';

@Controller('organizations')
@UseGuards(SessionGuard)
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly members: OrganizationMembersService,
    private readonly permissions: PermissionsService,
    private readonly periods: FiscalPeriodsService,
    private readonly numbering: DocumentNumberingService,
    private readonly auth: AuthService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  /** Declared before `:organizationId` so the static route is not captured as an identifier. */
  @Get('reference-data')
  referenceData() {
    return { data: referenceData };
  }

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return {
      data: await this.organizations.listForUser(
        request.auth.user.id,
        getCookie(request, ACTIVE_ORGANIZATION_COOKIE),
      ),
    };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() input: CreateOrganizationDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`org:create:${request.auth.user.id}`, 10, 60 * 60);
    const organization = await this.organizations.create(request.auth.user, input, metadata);
    setActiveOrganizationCookie(response, organization.id);
    return { data: organization };
  }

  @Get(':organizationId')
  @UseGuards(OrganizationGuard)
  @RequirePermission('organization.view')
  async detail(@Req() request: OrganizationRequest) {
    return { data: await this.organizations.detail(request.organization) };
  }

  @Patch(':organizationId')
  @UseGuards(OrganizationGuard)
  @RequirePermission('organization.update')
  async update(@Body() input: UpdateOrganizationDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.organizations.updateSection(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Post(':organizationId/finalize')
  @HttpCode(200)
  @UseGuards(OrganizationGuard)
  @RequirePermission('organization.finalize')
  async finalize(
    @Req() request: OrganizationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    const organization = await this.organizations.finalize(
      request.organization,
      request.auth.user,
      metadata,
    );
    setActiveOrganizationCookie(response, organization.id);
    return { data: organization };
  }

  /** Remembers the caller's working organization after membership has been validated. No permission
   * is required — this is session bookkeeping about an organization the caller already belongs to,
   * not a books-data view. */
  @Post(':organizationId/activate')
  @HttpCode(200)
  @UseGuards(OrganizationGuard)
  activate(@Req() request: OrganizationRequest, @Res({ passthrough: true }) response: Response) {
    setActiveOrganizationCookie(response, request.organization.id);
    return {
      data: {
        activeOrganizationId: request.organization.id,
        role: request.organization.role,
        status: request.organization.status,
        permissions: Array.from(request.organization.permissions),
      },
    };
  }

  @Get(':organizationId/members')
  @UseGuards(OrganizationGuard)
  @RequirePermission('members.view')
  async listMembers(@Req() request: OrganizationRequest) {
    return { data: await this.members.listMembers(request.organization.id) };
  }

  @Patch(':organizationId/members/:memberId')
  @UseGuards(OrganizationGuard)
  @RequirePermission('members.update')
  async updateMember(
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() input: UpdateMemberDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.members.updateMember(
        request.organization,
        request.auth.user,
        memberId,
        input,
        metadata,
      ),
    };
  }

  @Delete(':organizationId/members/:memberId')
  @HttpCode(204)
  @UseGuards(OrganizationGuard)
  @RequirePermission('members.remove')
  async removeMember(
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.members.removeMember(request.organization, request.auth.user, memberId, metadata);
  }

  @Get(':organizationId/invitations')
  @UseGuards(OrganizationGuard)
  @RequirePermission('invitations.view')
  async invitations(@Req() request: OrganizationRequest) {
    return { data: await this.members.listInvitations(request.organization.id) };
  }

  @Post(':organizationId/invitations')
  @HttpCode(201)
  @UseGuards(OrganizationGuard)
  @RequirePermission('members.invite')
  async invite(@Body() input: InviteMemberDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`org:invite:${request.organization.id}`, 60, 60 * 60);
    return {
      data: await this.members.invite(request.organization, request.auth.user, input, metadata),
    };
  }

  @Delete(':organizationId/invitations/:invitationId')
  @HttpCode(204)
  @UseGuards(OrganizationGuard)
  @RequirePermission('invitations.revoke')
  async revokeInvitation(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.members.revokeInvitation(
      request.organization,
      request.auth.user,
      invitationId,
      metadata,
    );
  }

  @Get(':organizationId/roles')
  @UseGuards(OrganizationGuard)
  @RequirePermission('roles.view')
  async roleMatrix(@Req() request: OrganizationRequest) {
    return { data: await this.permissions.getRoleMatrix(request.organization.id) };
  }

  @Patch(':organizationId/roles/:role')
  @UseGuards(OrganizationGuard)
  @RequirePermission('roles.manage')
  async updateRolePermissions(
    @Param('role') role: string,
    @Body() input: UpdateRolePermissionsDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.permissions.updateRolePermissions(
        request.organization.id,
        role,
        input.changes,
        request.auth.user,
        metadata,
      ),
    };
  }

  @Get(':organizationId/periods')
  @UseGuards(OrganizationGuard)
  @RequirePermission('periods.view')
  async fiscalPeriods(@Req() request: OrganizationRequest) {
    return { data: await this.periods.list(request.organization.id) };
  }

  @Post(':organizationId/periods/fiscal-years')
  @HttpCode(201)
  @UseGuards(OrganizationGuard)
  @RequirePermission('periods.manage')
  async generateFiscalYear(
    @Body() input: GenerateFiscalYearDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.periods.generateFiscalYear(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Post(':organizationId/periods/:periodId/close')
  @HttpCode(200)
  @UseGuards(OrganizationGuard)
  @RequirePermission('periods.close')
  async closePeriod(
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() input: PeriodTransitionDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.periods.close(
        request.organization,
        request.auth.user,
        periodId,
        input,
        metadata,
      ),
    };
  }

  @Post(':organizationId/periods/:periodId/lock')
  @HttpCode(200)
  @UseGuards(OrganizationGuard)
  @RequirePermission('periods.close')
  async lockPeriod(
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() input: PeriodTransitionDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.periods.lock(
        request.organization,
        request.auth.user,
        periodId,
        input,
        metadata,
      ),
    };
  }

  @Post(':organizationId/periods/:periodId/reopen')
  @HttpCode(200)
  @UseGuards(OrganizationGuard)
  @RequirePermission('periods.unlock')
  async reopenPeriod(
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() input: PeriodTransitionDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.periods.reopen(
        request.organization,
        request.auth.user,
        periodId,
        input,
        metadata,
      ),
    };
  }

  @Post(':organizationId/periods/:periodId/unlock')
  @HttpCode(200)
  @UseGuards(OrganizationGuard)
  @RequirePermission('periods.unlock')
  async unlockPeriod(
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() input: PeriodTransitionDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.periods.unlock(
        request.organization,
        request.auth.user,
        periodId,
        input,
        metadata,
      ),
    };
  }

  @Get(':organizationId/numbering')
  @UseGuards(OrganizationGuard)
  @RequirePermission('numbering.view')
  async numberingDetail(@Req() request: OrganizationRequest) {
    return { data: await this.numbering.detail(request.organization.id) };
  }

  @Patch(':organizationId/numbering/journal')
  @UseGuards(OrganizationGuard)
  @RequirePermission('numbering.manage')
  async updateJournalNumbering(
    @Body() input: UpdateJournalNumberingDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.numbering.updateJournalConfig(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }
}

/**
 * Invitation tokens travel in the request body rather than the URL so they stay out of access
 * logs, referrers, and browser history.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly auth: AuthService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  async preview(@Body() input: InvitationTokenDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`org:invite-preview:${metadata.ipHash}`, 30, 60 * 60);
    return { data: await this.organizations.previewInvitation(input.token) };
  }

  @Post('accept')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async accept(
    @Body() input: InvitationTokenDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`org:invite-accept:${metadata.ipHash}`, 20, 60 * 60);
    const result = await this.organizations.acceptInvitation(
      input.token,
      request.auth.user,
      metadata,
    );
    setActiveOrganizationCookie(response, result.organizationId);
    return { data: result };
  }
}
