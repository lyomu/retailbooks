import {
  BadRequestException,
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
  UseGuards,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { EntitlementsService } from './entitlements.service.js';
import { PlatformAccessService } from './platform-access.service.js';
import { writePlatformAudit } from './platform-audit.js';
import { PlatformCatalogService } from './platform-catalog.service.js';
import { RequirePlatformRole, type PlatformRequest } from './platform-context.js';
import { PlatformOperationsService } from './platform-operations.service.js';
import { PlatformTenantsService } from './platform-tenants.service.js';
import { PlatformGuard } from './platform.guard.js';
import {
  AssignPlanDto,
  CreateFeatureFlagDto,
  CreatePlanDto,
  FailedJobSearchDto,
  FlagPreviewDto,
  GrantPlatformAdminDto,
  OrganizationSearchDto,
  PlatformAuditSearchDto,
  ReactivateOrganizationDto,
  SecurityEventSearchDto,
  SuspendOrganizationDto,
  UpdateFeatureFlagDto,
  UpdatePlanDto,
  UpdateUserStatusDto,
  UpsertEntitlementDto,
  UpsertFlagRuleDto,
  UserSearchDto,
} from './platform.dto.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * The platform-administration console API.
 *
 * Every route sits behind `SessionGuard` then `PlatformGuard`, and declares the minimum platform
 * role it needs with `@RequirePlatformRole`. Declaring it on the route rather than checking inside
 * the service is deliberate: it puts the boundary where a test that walks the registered
 * controllers can see it, which is the same lesson the organization boundary matrix already
 * encodes after Phases 5 and 6 shipped uncovered endpoints.
 *
 * Nothing here reads a tenant's books. Reads are standing and adoption; writes are status, plans,
 * flags, and reference data.
 */
@Controller('platform')
@UseGuards(SessionGuard, PlatformGuard)
export class PlatformController {
  constructor(
    private readonly access: PlatformAccessService,
    private readonly tenants: PlatformTenantsService,
    private readonly catalog: PlatformCatalogService,
    private readonly operations: PlatformOperationsService,
    private readonly entitlements: EntitlementsService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private ipHash(request: PlatformRequest): string | null {
    return requestMetadata(request, this.auth.pepper).ipHash;
  }

  // --- Session -----------------------------------------------------------------------------

  /** Who the console is talking to, and what they may do. The console's first call. */
  @Get('me')
  me(@Req() request: PlatformRequest) {
    return {
      data: {
        userId: request.platform.userId,
        email: request.platform.email,
        displayName: request.platform.displayName,
        role: request.platform.role,
      },
    };
  }

  // --- Administrators ----------------------------------------------------------------------

  @Get('admins')
  @RequirePlatformRole('SUPERADMIN')
  async admins() {
    return { data: await this.access.listAdmins() };
  }

  @Post('admins')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async grantAdmin(@Body() input: GrantPlatformAdminDto, @Req() request: PlatformRequest) {
    const granted = await this.access.grant(request.platform, input.email, input.role, input.note);
    // Non-disclosure: an address without a RetailBooks account fails the same way as one the
    // caller simply mistyped. This endpoint does not confirm who has an account.
    if (!granted) throw new BadRequestException('That address cannot be granted platform access.');
    await this.prisma.$transaction((tx) =>
      writePlatformAudit(tx, request.platform, {
        eventKey: 'platform.admin_granted',
        targetType: 'platform_admin',
        targetId: granted.id,
        after: { role: granted.role },
        reason: input.note ?? null,
        ipHash: this.ipHash(request),
      }),
    );
    return { data: granted };
  }

  @Delete('admins/:platformAdminId')
  @HttpCode(204)
  @RequirePlatformRole('SUPERADMIN')
  async revokeAdmin(
    @Param('platformAdminId', new ParseUUIDPipe()) platformAdminId: string,
    @Req() request: PlatformRequest,
  ) {
    // Losing the last superadmin locks the platform out of its own console, and the only way back
    // would be to reinstate the bootstrap allowlist. Refuse rather than rely on care.
    if (platformAdminId === request.platform.id && (await this.access.activeSuperadmins()) <= 1) {
      throw new BadRequestException('Grant another superadmin before revoking your own access.');
    }
    if (!(await this.access.revoke(platformAdminId))) {
      throw new BadRequestException('That platform grant is not active.');
    }
    await this.prisma.$transaction((tx) =>
      writePlatformAudit(tx, request.platform, {
        eventKey: 'platform.admin_revoked',
        targetType: 'platform_admin',
        targetId: platformAdminId,
        ipHash: this.ipHash(request),
      }),
    );
  }

  // --- Organizations -----------------------------------------------------------------------

  @Get('organizations')
  @RequirePlatformRole('SUPPORT')
  async organizations(@Query() query: OrganizationSearchDto) {
    return this.tenants.searchOrganizations(query);
  }

  @Get('organizations/:organizationId')
  @RequirePlatformRole('SUPPORT')
  async organization(@Param('organizationId', new ParseUUIDPipe()) organizationId: string) {
    return { data: await this.tenants.organizationDetail(organizationId) };
  }

  @Post('organizations/:organizationId/suspend')
  @HttpCode(200)
  @RequirePlatformRole('OPERATIONS')
  async suspend(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: SuspendOrganizationDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.tenants.suspendOrganization(
        request.platform,
        organizationId,
        input.reason,
        this.ipHash(request),
      ),
    };
  }

  @Post('organizations/:organizationId/reactivate')
  @HttpCode(200)
  @RequirePlatformRole('OPERATIONS')
  async reactivate(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: ReactivateOrganizationDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.tenants.reactivateOrganization(
        request.platform,
        organizationId,
        input.reason,
        this.ipHash(request),
      ),
    };
  }

  @Post('organizations/:organizationId/plan')
  @HttpCode(200)
  @RequirePlatformRole('SUPERADMIN')
  async assignPlan(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: AssignPlanDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.tenants.assignPlan(
        request.platform,
        organizationId,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Get('organizations/:organizationId/entitlements')
  @RequirePlatformRole('SUPPORT')
  async organizationEntitlements(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return { data: await this.entitlements.forOrganization(organizationId) };
  }

  // --- Users -------------------------------------------------------------------------------

  @Get('users')
  @RequirePlatformRole('SUPPORT')
  async users(@Query() query: UserSearchDto) {
    return this.tenants.searchUsers(query);
  }

  @Get('users/:userId')
  @RequirePlatformRole('SUPPORT')
  async user(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return { data: await this.tenants.userDetail(userId) };
  }

  @Patch('users/:userId/status')
  @RequirePlatformRole('OPERATIONS')
  async updateUserStatus(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: UpdateUserStatusDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.tenants.updateUserStatus(
        request.platform,
        userId,
        input,
        this.ipHash(request),
      ),
    };
  }

  // --- Plans and entitlements ---------------------------------------------------------------

  @Get('plans')
  @RequirePlatformRole('SUPPORT')
  async plans() {
    return { data: await this.catalog.listPlans() };
  }

  @Post('plans')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async createPlan(@Body() input: CreatePlanDto, @Req() request: PlatformRequest) {
    return { data: await this.catalog.createPlan(request.platform, input, this.ipHash(request)) };
  }

  @Patch('plans/:planId')
  @RequirePlatformRole('SUPERADMIN')
  async updatePlan(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() input: UpdatePlanDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.updatePlan(request.platform, planId, input, this.ipHash(request)),
    };
  }

  @Post('plans/:planId/entitlements')
  @HttpCode(200)
  @RequirePlatformRole('SUPERADMIN')
  async upsertEntitlement(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Body() input: UpsertEntitlementDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.upsertEntitlement(
        request.platform,
        planId,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Delete('plans/:planId/entitlements/:key')
  @HttpCode(204)
  @RequirePlatformRole('SUPERADMIN')
  async removeEntitlement(
    @Param('planId', new ParseUUIDPipe()) planId: string,
    @Param('key') key: string,
    @Req() request: PlatformRequest,
  ) {
    await this.catalog.removeEntitlement(request.platform, planId, key, this.ipHash(request));
  }

  // --- Feature flags -------------------------------------------------------------------------

  @Get('feature-flags')
  @RequirePlatformRole('SUPPORT')
  async flags() {
    return { data: await this.catalog.listFlags() };
  }

  @Post('feature-flags')
  @HttpCode(201)
  @RequirePlatformRole('SUPERADMIN')
  async createFlag(@Body() input: CreateFeatureFlagDto, @Req() request: PlatformRequest) {
    return { data: await this.catalog.createFlag(request.platform, input, this.ipHash(request)) };
  }

  @Patch('feature-flags/:flagId')
  @RequirePlatformRole('SUPERADMIN')
  async updateFlag(
    @Param('flagId', new ParseUUIDPipe()) flagId: string,
    @Body() input: UpdateFeatureFlagDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.updateFlag(request.platform, flagId, input, this.ipHash(request)),
    };
  }

  @Post('feature-flags/:flagId/rules')
  @HttpCode(200)
  @RequirePlatformRole('SUPERADMIN')
  async upsertFlagRule(
    @Param('flagId', new ParseUUIDPipe()) flagId: string,
    @Body() input: UpsertFlagRuleDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.catalog.upsertFlagRule(
        request.platform,
        flagId,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Delete('feature-flags/rules/:ruleId')
  @HttpCode(204)
  @RequirePlatformRole('SUPERADMIN')
  async removeFlagRule(
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Req() request: PlatformRequest,
  ) {
    await this.catalog.removeFlagRule(request.platform, ruleId, this.ipHash(request));
  }

  /** Explains what a given audience would see, before any tenant matches it. */
  @Get('feature-flags/:key/preview')
  @RequirePlatformRole('SUPPORT')
  async previewFlag(@Param('key') key: string, @Query() query: FlagPreviewDto) {
    return { data: await this.entitlements.preview({ flagKey: key, ...query }) };
  }

  // --- Operations ----------------------------------------------------------------------------

  @Get('jobs/health')
  @RequirePlatformRole('SUPPORT')
  async queueHealth() {
    return { data: await this.operations.queueHealth() };
  }

  @Get('jobs/failed')
  @RequirePlatformRole('SUPPORT')
  async failedJobs(@Query() query: FailedJobSearchDto) {
    return this.operations.failedJobs(query);
  }

  @Post('jobs/:executionId/retry')
  @HttpCode(200)
  @RequirePlatformRole('OPERATIONS')
  async retryJob(
    @Param('executionId', new ParseUUIDPipe()) executionId: string,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.operations.retryJob(request.platform, executionId, this.ipHash(request)),
    };
  }

  @Get('security-events')
  @RequirePlatformRole('SUPPORT')
  async securityEvents(@Query() query: SecurityEventSearchDto) {
    return this.operations.securityEvents(query);
  }

  @Get('audit')
  @RequirePlatformRole('SUPPORT')
  async platformAudit(@Query() query: PlatformAuditSearchDto) {
    return this.operations.platformAudit(query);
  }

  @Get('analytics')
  @RequirePlatformRole('SUPPORT')
  async analytics() {
    return { data: await this.operations.analytics() };
  }
}
