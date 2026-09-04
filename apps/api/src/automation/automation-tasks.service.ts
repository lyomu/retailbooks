import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';

/**
 * `AutomationTask` rows are created only by a workflow rule's `CREATE_TASK` action
 * (`WorkflowsService#runRule`); this is the only place they are read or resolved. Completion is
 * self-service -- the assignee closes their own task -- with `automation.rules.manage` as the
 * override for reassigning/unblocking work an assignee can no longer act on.
 */
@Injectable()
export class AutomationTasksService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(organizationId: string, userId: string, includeCompleted = false) {
    return this.prisma.automationTask.findMany({
      where: {
        organizationId,
        assignedToUserId: userId,
        ...(includeCompleted ? {} : { completedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async complete(
    context: OrganizationContext,
    user: PublicUser,
    taskId: string,
    metadata: RequestMetadata,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.automationTask.findFirst({
        where: { id: taskId, organizationId: context.id },
      });
      if (!task) throw new NotFoundException('Task not found.');
      if (task.completedAt) throw new ConflictException('This task is already complete.');
      const isAssignee = task.assignedToUserId === user.id;
      const canManage = context.permissions.has('automation.rules.manage');
      if (!isAssignee && !canManage) {
        throw new ForbiddenException(
          'Only the assignee or an automation manager can complete this task.',
        );
      }
      const updated = await tx.automationTask.update({
        where: { id: taskId },
        data: { completedAt: new Date() },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.task_completed',
        entityType: 'automation_task',
        entityId: taskId,
        action: AuditAction.UPDATE,
        after: { completedAt: updated.completedAt?.toISOString() ?? null },
        ipHash: metadata.ipHash,
      });
      return updated;
    });
  }
}
