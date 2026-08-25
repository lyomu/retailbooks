import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IsDateString } from 'class-validator';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { RequirePermission, type OrganizationRequest } from './organization-context.js';
import { OrganizationGuard } from './organization.guard.js';
import { FxRevaluationService } from './fx-revaluation.service.js';

class RunFxRevaluationDto {
  @IsDateString({}, { message: 'asOfDate must be an ISO date' })
  asOfDate!: string;
}

/**
 * Running a revaluation is a period-close-class accounting action (`journals.post`); reading past
 * runs needs only `journals.view`.
 */
@Controller('organizations/:organizationId/fx-revaluations')
@UseGuards(SessionGuard, OrganizationGuard)
export class FxRevaluationController {
  constructor(
    private readonly fxRevaluation: FxRevaluationService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('journals.view')
  list(@Req() request: OrganizationRequest) {
    return { data: this.fxRevaluation.list(request.organization.id) };
  }

  @Post('run')
  @HttpCode(200)
  @RequirePermission('journals.post')
  async run(@Body() input: RunFxRevaluationDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.fxRevaluation.run(
        request.organization,
        request.auth.user,
        input.asOfDate,
        metadata,
      ),
    };
  }
}
