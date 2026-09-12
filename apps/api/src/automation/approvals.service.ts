import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalPolicyStatus,
  ApprovalRequestStatus,
  ApprovalStepStatus,
  AuditAction,
  MembershipStatus,
  type ApprovalTargetType,
  type Prisma,
} from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import {
  assertNoPendingApproval,
  currentApprovalTargetVersion,
  type ApprovalTargetSnapshot,
} from './approval-targets.js';
import { DomainEventsService } from './domain-events.service.js';
import type {
  ApprovalDecisionDto,
  ApprovalPolicyStepDto,
  CreateApprovalPolicyDto,
  UpdateApprovalPolicyDto,
} from './approvals.dto.js';

type ApprovalPolicyDetail = Prisma.ApprovalPolicyGetPayload<{
  include: { steps: { orderBy: { stepNumber: 'asc' } } };
}>;

export type { ApprovalTargetSnapshot } from './approval-targets.js';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  async listPolicies(organizationId: string) {
    return this.prisma.approvalPolicy.findMany({
      where: { organizationId },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
      orderBy: [{ targetType: 'asc' }, { priority: 'desc' }, { name: 'asc' }],
    });
  }

  async createPolicy(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateApprovalPolicyDto,
    metadata: RequestMetadata,
  ) {
    const steps = normalizeSteps(input.steps);
    await this.assertApproversAreMembers(context.id, steps);
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.approvalPolicy.create({
        data: {
          organizationId: context.id,
          createdByUserId: user.id,
          name: input.name,
          targetType: input.targetType,
          priority: input.priority ?? 0,
          conditions: (input.conditions ?? {}) as Prisma.InputJsonObject,
          allowSelfApproval: input.allowSelfApproval ?? false,
          steps: { create: steps },
        },
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.approval_policy_created',
        entityType: 'approval_policy',
        entityId: policy.id,
        action: AuditAction.CREATE,
        after: policySnapshot(policy),
        ipHash: metadata.ipHash,
      });
      return policy;
    });
  }

  async updatePolicy(
    context: OrganizationContext,
    user: PublicUser,
    policyId: string,
    input: UpdateApprovalPolicyDto,
    metadata: RequestMetadata,
  ) {
    const before = await this.findPolicy(context.id, policyId);
    if (before.status === ApprovalPolicyStatus.ACTIVE) {
      throw new ConflictException(
        'Deactivate an approval policy before changing its policy steps.',
      );
    }
    const steps = input.steps ? normalizeSteps(input.steps) : undefined;
    if (steps) await this.assertApproversAreMembers(context.id, steps);
    return this.prisma.$transaction(async (tx) => {
      if (steps) await tx.approvalPolicyStep.deleteMany({ where: { policyId } });
      const updated = await tx.approvalPolicy.update({
        where: { id: policyId },
        data: {
          name: input.name,
          priority: input.priority,
          conditions: input.conditions as Prisma.InputJsonObject | undefined,
          allowSelfApproval: input.allowSelfApproval,
          version: { increment: 1 },
          ...(steps ? { steps: { create: steps } } : {}),
        },
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.approval_policy_updated',
        entityType: 'approval_policy',
        entityId: policyId,
        action: AuditAction.UPDATE,
        before: policySnapshot(before),
        after: policySnapshot(updated),
        ipHash: metadata.ipHash,
      });
      return updated;
    });
  }

  async setPolicyStatus(
    context: OrganizationContext,
    user: PublicUser,
    policyId: string,
    status: 'ACTIVE' | 'INACTIVE',
    metadata: RequestMetadata,
  ) {
    const policy = await this.findPolicy(context.id, policyId);
    if (status === ApprovalPolicyStatus.ACTIVE) {
      if (!policy.steps.length)
        throw new BadRequestException('An active policy needs at least one step.');
      const conflicting = await this.prisma.approvalPolicy.findFirst({
        where: {
          organizationId: context.id,
          targetType: policy.targetType,
          priority: policy.priority,
          status: ApprovalPolicyStatus.ACTIVE,
          id: { not: policy.id },
        },
        select: { id: true },
      });
      if (conflicting) {
        throw new ConflictException(
          'An active policy with this target and priority already exists; use a distinct priority.',
        );
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.approvalPolicy.update({
        where: { id: policyId },
        data: { status, version: { increment: 1 } },
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey:
          status === ApprovalPolicyStatus.ACTIVE
            ? 'automation.approval_policy_activated'
            : 'automation.approval_policy_deactivated',
        entityType: 'approval_policy',
        entityId: policyId,
        action: AuditAction.UPDATE,
        before: policySnapshot(policy),
        after: policySnapshot(updated),
        ipHash: metadata.ipHash,
      });
      return updated;
    });
  }

  /** Called by a target adapter inside its submit transaction after it has frozen target state. */
  async submit(
    tx: Prisma.TransactionClient,
    context: OrganizationContext,
    user: PublicUser,
    target: ApprovalTargetSnapshot,
    metadata: RequestMetadata,
  ) {
    const policy = await this.resolvePolicy(context.id, user.id, context.role.key, target);
    if (!policy) return null;
    const request = await tx.approvalRequest.create({
      data: {
        organizationId: context.id,
        policyId: policy.id,
        submitterUserId: user.id,
        targetType: target.type,
        targetId: target.id,
        targetVersion: target.updatedAt,
        targetSnapshot: target.summary,
        steps: {
          create: policy.steps.map((step) => ({
            stepNumber: step.stepNumber,
            approverUserId: step.approverUserId,
            requiredPermission: step.requiredPermission,
          })),
        },
      },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });
    await writeAuditEvent(tx, {
      organizationId: context.id,
      actorUserId: user.id,
      eventKey: 'automation.approval_submitted',
      entityType: 'approval_request',
      entityId: request.id,
      action: AuditAction.CREATE,
      after: { targetType: target.type, targetId: target.id, policyId: policy.id },
      ipHash: metadata.ipHash,
    });
    await this.events.emit(tx, {
      organizationId: context.id,
      aggregateType: 'approval_request',
      aggregateId: request.id,
      eventName: 'approval.submitted',
      payload: { targetType: target.type, targetId: target.id, policyId: policy.id },
    });
    return request;
  }

  async pendingForTarget(organizationId: string, targetType: ApprovalTargetType, targetId: string) {
    return this.prisma.approvalRequest.findFirst({
      where: { organizationId, targetType, targetId, status: ApprovalRequestStatus.PENDING },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  /** Full detail/history for one request: its policy, every step, and every decision on each step. */
  async detail(context: OrganizationContext, requestId: string) {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id: requestId, organizationId: context.id },
      include: {
        policy: true,
        steps: {
          orderBy: { stepNumber: 'asc' },
          include: { decisions: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!request) throw new NotFoundException('Approval request not found.');
    return request;
  }

  /** The submitter's own queue -- what they have in flight or resolved, most recent first. */
  async submittedByMe(context: OrganizationContext, user: PublicUser) {
    return this.prisma.approvalRequest.findMany({
      where: { organizationId: context.id, submitterUserId: user.id },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
  }

  /**
   * A pending request can be withdrawn by its submitter (they changed their mind, or the document
   * needs edits first) or by anyone who can manage approval policies. There is no resubmit action
   * distinct from this: a cancelled or rejected request no longer counts as "pending" for
   * `assertNoDuplicatePendingApproval`, so submitting the target again through
   * `ApprovalTargetsService#submit` freezes a fresh snapshot and simply starts a new request.
   */
  async cancel(
    context: OrganizationContext,
    user: PublicUser,
    requestId: string,
    metadata: RequestMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.approvalRequest.findFirst({
        where: { id: requestId, organizationId: context.id },
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
      });
      if (!request) throw new NotFoundException('Approval request not found.');
      if (request.status !== ApprovalRequestStatus.PENDING) {
        throw new ConflictException('Only a pending approval request can be cancelled.');
      }
      const isSubmitter = request.submitterUserId === user.id;
      const canManage = context.permissions.has('automation.approvals.manage');
      if (!isSubmitter && !canManage) {
        throw new ForbiddenException(
          'Only the submitter or an approvals manager can cancel this request.',
        );
      }
      const cancelledAt = new Date();
      const updated = await tx.approvalRequest.update({
        where: { id: request.id },
        data: { status: ApprovalRequestStatus.CANCELLED, completedAt: cancelledAt, cancelledAt },
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.approval_cancelled',
        entityType: 'approval_request',
        entityId: request.id,
        action: AuditAction.UPDATE,
        after: { status: 'CANCELLED' },
        ipHash: metadata.ipHash,
      });
      await this.events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'approval_request',
        aggregateId: request.id,
        eventName: 'approval.cancelled',
        payload: { targetType: request.targetType, targetId: request.targetId },
      });
      return updated;
    });
  }

  async inbox(context: OrganizationContext, user: PublicUser) {
    const steps = await this.prisma.approvalRequestStep.findMany({
      where: { status: ApprovalStepStatus.PENDING },
      include: {
        request: { include: { policy: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return steps.filter(
      (step) =>
        step.request.organizationId === context.id &&
        (step.approverUserId === user.id ||
          (step.requiredPermission !== null &&
            context.permissions.has(step.requiredPermission as never))),
    );
  }

  async decide(
    context: OrganizationContext,
    user: PublicUser,
    requestId: string,
    input: ApprovalDecisionDto,
    metadata: RequestMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ locked: string }>>`
        SELECT pg_advisory_xact_lock(hashtextextended(${`approval-request:${requestId}`}, 0))::text AS locked
      `;
      void lock;
      const request = await tx.approvalRequest.findFirst({
        where: { id: requestId, organizationId: context.id },
        include: { policy: true, steps: { orderBy: { stepNumber: 'asc' } } },
      });
      if (!request) throw new NotFoundException('Approval request not found.');
      if (request.status !== ApprovalRequestStatus.PENDING) {
        throw new ConflictException('This approval request is no longer awaiting a decision.');
      }
      const currentVersion = await currentApprovalTargetVersion(
        tx,
        context.id,
        request.targetType,
        request.targetId,
      );
      if (!currentVersion || currentVersion.getTime() !== request.targetVersion.getTime()) {
        throw new ConflictException(
          'This document changed after the approval request was submitted; cancel and resubmit.',
        );
      }
      const step = request.steps.find(
        (candidate) => candidate.stepNumber === request.currentStepNumber,
      );
      if (!step || step.status !== ApprovalStepStatus.PENDING)
        throw new ConflictException('The current approval step is unavailable.');
      const assigned = step.approverUserId === user.id;
      const delegated =
        step.requiredPermission !== null &&
        context.permissions.has(step.requiredPermission as never);
      if (!assigned && !delegated)
        throw new ConflictException('You are not assigned to this approval step.');
      if (!request.policy.allowSelfApproval && request.submitterUserId === user.id) {
        throw new ConflictException('The submitter cannot approve their own request.');
      }
      const decisionStatus =
        input.decision === 'APPROVED' ? ApprovalStepStatus.APPROVED : ApprovalStepStatus.REJECTED;
      await tx.approvalRequestStep.update({
        where: { id: step.id },
        data: { status: decisionStatus, decidedByUserId: user.id, decidedAt: new Date() },
      });
      await tx.approvalDecision.create({
        data: {
          stepId: step.id,
          actorUserId: user.id,
          decision: decisionStatus,
          comment: input.comment ?? null,
        },
      });
      const finalStep = request.steps.at(-1)?.stepNumber === step.stepNumber;
      const requestStatus =
        input.decision === 'REJECTED'
          ? ApprovalRequestStatus.REJECTED
          : finalStep
            ? ApprovalRequestStatus.APPROVED
            : ApprovalRequestStatus.PENDING;
      const updated = await tx.approvalRequest.update({
        where: { id: request.id },
        data: {
          status: requestStatus,
          currentStepNumber:
            finalStep || input.decision === 'REJECTED'
              ? request.currentStepNumber
              : request.currentStepNumber + 1,
          completedAt: requestStatus === ApprovalRequestStatus.PENDING ? null : new Date(),
        },
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
      });
      const eventName =
        input.decision === 'REJECTED'
          ? 'approval.rejected'
          : requestStatus === ApprovalRequestStatus.APPROVED
            ? 'approval.completed'
            : 'approval.step-approved';
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: `automation.${eventName}`,
        entityType: 'approval_request',
        entityId: request.id,
        action: AuditAction.UPDATE,
        after: { stepNumber: step.stepNumber, decision: input.decision, status: requestStatus },
        ipHash: metadata.ipHash,
      });
      await this.events.emit(tx, {
        organizationId: context.id,
        aggregateType: 'approval_request',
        aggregateId: request.id,
        eventName,
        payload: {
          requestId: request.id,
          targetType: request.targetType,
          targetId: request.targetId,
          stepNumber: step.stepNumber,
        },
      });
      return updated;
    });
  }

  async assertNoPendingApproval(
    tx: Prisma.TransactionClient,
    organizationId: string,
    targetType: ApprovalTargetType,
    targetId: string,
  ) {
    return assertNoPendingApproval(tx, organizationId, targetType, targetId);
  }

  private async resolvePolicy(
    organizationId: string,
    submitterUserId: string,
    submitterRoleKey: string,
    target: ApprovalTargetSnapshot,
  ): Promise<ApprovalPolicyDetail | null> {
    const candidates = await this.prisma.approvalPolicy.findMany({
      where: { organizationId, targetType: target.type, status: ApprovalPolicyStatus.ACTIVE },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return (
      candidates.find((policy) =>
        matchesConditions(policy.conditions, submitterUserId, submitterRoleKey, target),
      ) ?? null
    );
  }

  private async findPolicy(
    organizationId: string,
    policyId: string,
  ): Promise<ApprovalPolicyDetail> {
    const policy = await this.prisma.approvalPolicy.findFirst({
      where: { id: policyId, organizationId },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });
    if (!policy) throw new NotFoundException('Approval policy not found.');
    return policy;
  }

  private async assertApproversAreMembers(
    organizationId: string,
    steps: ReturnType<typeof normalizeSteps>,
  ) {
    const ids = [
      ...new Set(steps.flatMap((step) => (step.approverUserId ? [step.approverUserId] : []))),
    ];
    if (!ids.length) return;
    const count = await this.prisma.organizationMember.count({
      where: { organizationId, userId: { in: ids }, status: MembershipStatus.ACTIVE },
    });
    if (count !== ids.length)
      throw new BadRequestException('Every named approver must be an active member.');
  }
}

function normalizeSteps(steps: ApprovalPolicyStepDto[]) {
  if (!steps.length || steps.length > 12)
    throw new BadRequestException('Policies need one to twelve steps.');
  return steps.map((step, index) => {
    if (!step.approverUserId && !step.requiredPermission) {
      throw new BadRequestException('Each approval step needs an approver or required permission.');
    }
    return {
      stepNumber: index + 1,
      approverUserId: step.approverUserId ?? null,
      requiredPermission: step.requiredPermission ?? null,
      label: step.label ?? null,
    };
  });
}

function matchesConditions(
  value: Prisma.JsonValue,
  submitterUserId: string,
  submitterRoleKey: string,
  target: ApprovalTargetSnapshot,
): boolean {
  if (!value || Array.isArray(value) || typeof value !== 'object') return true;
  const conditions = value as Record<string, unknown>;
  if (
    Array.isArray(conditions.submitterUserIds) &&
    !conditions.submitterUserIds.includes(submitterUserId)
  ) {
    return false;
  }
  if (
    Array.isArray(conditions.submitterRoles) &&
    !conditions.submitterRoles.includes(submitterRoleKey)
  ) {
    return false;
  }
  if (
    Array.isArray(conditions.tagIds) &&
    (!target.tagId || !conditions.tagIds.includes(target.tagId))
  ) {
    return false;
  }
  if (
    Array.isArray(conditions.projectIds) &&
    (!target.projectId || !conditions.projectIds.includes(target.projectId))
  ) {
    return false;
  }
  const amount = target.amountMinor;
  if (
    amount !== undefined &&
    typeof conditions.minimumAmountMinor === 'string' &&
    amount < BigInt(conditions.minimumAmountMinor)
  )
    return false;
  if (
    amount !== undefined &&
    typeof conditions.maximumAmountMinor === 'string' &&
    amount > BigInt(conditions.maximumAmountMinor)
  )
    return false;
  return true;
}

function policySnapshot(policy: ApprovalPolicyDetail) {
  return {
    name: policy.name,
    targetType: policy.targetType,
    status: policy.status,
    priority: policy.priority,
    version: policy.version,
    steps: policy.steps.map((step) => ({
      stepNumber: step.stepNumber,
      approverUserId: step.approverUserId,
      requiredPermission: step.requiredPermission,
    })),
  };
}
