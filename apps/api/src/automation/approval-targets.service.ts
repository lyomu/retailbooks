import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ApprovalTargetType } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import {
  APPROVAL_TARGET_NATIVE_PERMISSION,
  assertNoDuplicatePendingApproval,
  loadApprovalTarget,
} from './approval-targets.js';
import { ApprovalsService } from './approvals.service.js';

/**
 * Bridges the generic, policy-driven `ApprovalsService` to the nine concrete document types it can
 * gate. Submitting freezes the document's current state into the request (`ApprovalsService#submit`
 * stores it as `targetSnapshot`/`targetVersion`); the actual finalize/post action for each target
 * type separately calls `assertNoPendingApproval` before it proceeds.
 */
@Injectable()
export class ApprovalTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
  ) {}

  async submit(
    context: OrganizationContext,
    user: PublicUser,
    targetType: ApprovalTargetType,
    targetId: string,
    metadata: RequestMetadata,
  ) {
    const nativePermission = APPROVAL_TARGET_NATIVE_PERMISSION[targetType];
    if (!context.permissions.has(nativePermission)) {
      throw new ForbiddenException(
        'Your role does not allow submitting this document for approval.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`approval-target:${targetType}:${targetId}`}, 0))::text AS locked
      `;
      await assertNoDuplicatePendingApproval(tx, context.id, targetType, targetId);
      const target = await loadApprovalTarget(tx, context.id, targetType, targetId);
      if (!target) throw new NotFoundException('This document was not found.');
      const request = await this.approvals.submit(tx, context, user, target, metadata);
      if (!request) {
        throw new BadRequestException(
          'No active approval policy applies to this document; there is nothing to route for approval.',
        );
      }
      return request;
    });
  }
}
