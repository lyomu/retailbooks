import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { ApprovalTargetsService } from './approval-targets.service.js';
import { SubmitApprovalRequestDto } from './approvals.dto.js';

/**
 * Submission entry point for the nine supported approval target types. Separate from
 * `ApprovalsController` (policy CRUD, inbox, decisions) because submitting requires an additional,
 * per-target-type permission check (`ApprovalTargetsService#submit`) beyond the flat
 * `automation.approvals.*` gate the rest of that controller uses.
 */
@Controller('organizations/:organizationId/automation/approval-requests')
@UseGuards(SessionGuard, OrganizationGuard)
export class ApprovalRequestsController {
  constructor(
    private readonly targets: ApprovalTargetsService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermission('automation.approvals.view')
  async submit(@Body() input: SubmitApprovalRequestDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.targets.submit(
        request.organization,
        request.auth.user,
        input.targetType,
        input.targetId,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }
}
