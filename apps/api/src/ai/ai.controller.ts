import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { FeatureFlagGuard, RequireFeatureFlag } from '../platform/feature-flag.guard.js';
import { PHASE13_FEATURE_FLAGS } from '../platform/phase13-feature-flags.js';
import { AiSuggestionsStore } from './ai-suggestions.store.js';
import { AskReportDto, ExplainNumberDto, SuggestionFeedbackDto } from './ai.dto.js';
import { AiModelGateway } from './ai-model.gateway.js';
import { AiOrchestrator } from './ai.orchestrator.js';

@Controller('organizations/:organizationId/ai')
@UseGuards(SessionGuard, OrganizationGuard, FeatureFlagGuard)
export class AiController {
  constructor(
    private readonly ai: AiOrchestrator,
    private readonly gateway: AiModelGateway,
    private readonly auth: AuthService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly config: ConfigService,
    private readonly suggestions: AiSuggestionsStore,
  ) {}

  @Get('settings')
  @RequirePermission('ai.settings.manage')
  async settings(@Req() request: OrganizationRequest) {
    const descriptor = this.gateway.descriptor();
    const enabled =
      descriptor.provider === 'PRIVATE' ||
      (descriptor.provider === 'HOSTED_LIMITED' &&
        (await this.gateway.isHostedEgressEnabled(request.organization.id)));
    return {
      data: {
        enabled,
        provider: descriptor.provider,
        model: descriptor.model,
      },
    };
  }

  @Post('ask')
  @RequirePermission('ai.assistant.ask')
  async ask(@Body() input: AskReportDto, @Req() request: OrganizationRequest) {
    // AI permission allows the assistant surface; financial evidence still requires the report
    // permission that would be required to view the same report directly.
    if (!request.organization.permissions.has('reports.view')) {
      throw new ForbiddenException('Your role does not allow viewing report evidence.');
    }
    const actorLimit = this.config.getOrThrow<number>('AI_REQUEST_LIMIT_PER_HOUR');
    const organizationLimit = this.config.getOrThrow<number>(
      'AI_ORGANIZATION_REQUEST_LIMIT_PER_HOUR',
    );
    await this.rateLimit.consume(
      `ai:ask:actor:${request.organization.id}:${request.auth.user.id}`,
      actorLimit,
      3_600,
    );
    await this.rateLimit.consume(
      `ai:ask:organization:${request.organization.id}`,
      organizationLimit,
      3_600,
    );
    return {
      data: await this.ai.explainReport(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Post('explain-number')
  @RequirePermission('ai.assistant.ask')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.REPORT_DRILLDOWN)
  async explainNumber(@Body() input: ExplainNumberDto, @Req() request: OrganizationRequest) {
    // Same double-gate as ask: the AI permission unlocks the assistant surface, but the
    // deterministic drill-down (and any evidence it can produce) still requires reports.view.
    if (!request.organization.permissions.has('reports.view')) {
      throw new ForbiddenException('Your role does not allow viewing report evidence.');
    }
    // Only the model call is rate-limited. A caller must always be able to reach the deterministic
    // number, so the budget meant to protect the private/hosted endpoint is not spent when AI is
    // off. Hosted calls blocked by the secondary egress gate still consume a small amount of this
    // budget -- acceptable, not a security question.
    if (this.gateway.descriptor().provider !== 'DISABLED') {
      const actorLimit = this.config.getOrThrow<number>('AI_REQUEST_LIMIT_PER_HOUR');
      const organizationLimit = this.config.getOrThrow<number>(
        'AI_ORGANIZATION_REQUEST_LIMIT_PER_HOUR',
      );
      await this.rateLimit.consume(
        `ai:explain:actor:${request.organization.id}:${request.auth.user.id}`,
        actorLimit,
        3_600,
      );
      await this.rateLimit.consume(
        `ai:explain:organization:${request.organization.id}`,
        organizationLimit,
        3_600,
      );
    }
    return {
      data: await this.ai.explainNumber(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Get('suggestions')
  @RequirePermission('ai.suggestions.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS)
  async listSuggestions(
    @Query('capability') capability: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.suggestions.list(request.organization.id, capability) };
  }

  @Post('suggestions/:suggestionId/accept')
  @RequirePermission('ai.suggestions.manage')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS)
  async acceptSuggestion(
    @Param('suggestionId', new ParseUUIDPipe()) suggestionId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.suggestions.accept(
        request.organization.id,
        suggestionId,
        request.auth.user.id,
        metadata,
      ),
    };
  }

  @Post('suggestions/:suggestionId/dismiss')
  @RequirePermission('ai.suggestions.manage')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS)
  async dismissSuggestion(
    @Param('suggestionId', new ParseUUIDPipe()) suggestionId: string,
    @Body() input: SuggestionFeedbackDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.suggestions.dismiss(
        request.organization.id,
        suggestionId,
        request.auth.user.id,
        metadata,
        input.note,
      ),
    };
  }

  @Post('suggestions/:suggestionId/correct')
  @RequirePermission('ai.suggestions.manage')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS)
  async correctSuggestion(
    @Param('suggestionId', new ParseUUIDPipe()) suggestionId: string,
    @Body() input: SuggestionFeedbackDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.suggestions.correct(
        request.organization.id,
        suggestionId,
        request.auth.user.id,
        metadata,
        input.note ?? '',
      ),
    };
  }
}
