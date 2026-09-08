import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type { PortalContext } from '../portals/portal-context.js';
import type { CreateCommentDto } from './collaboration.dto.js';
import { requireInternalTarget, requirePortalTarget, targetDefinition } from './target-registry.js';

@Injectable()
export class CollaborationService {
  constructor(private readonly prisma: PrismaService) {}

  async listCommentsInternal(context: OrganizationContext, type: string, id: string) {
    await requireInternalTarget(this.prisma, context, type, id, 'view');
    return this.listComments(context.id, type, id, false);
  }

  async requireInternalTarget(
    context: OrganizationContext,
    type: string,
    id: string,
    mode: 'view' | 'manage',
  ) {
    return requireInternalTarget(this.prisma, context, type, id, mode);
  }

  async addCommentInternal(
    context: OrganizationContext,
    user: PublicUser,
    type: string,
    id: string,
    input: CreateCommentDto,
  ) {
    if (!context.permissions.has('collaboration.comments.create')) {
      throw new ForbiddenException('Your role does not allow adding comments.');
    }
    const target = await requireInternalTarget(this.prisma, context, type, id, 'manage');
    const visibility = input.visibility ?? 'INTERNAL';
    if (
      visibility === 'CUSTOMER' &&
      (!target.definition.customerEligible ||
        !context.permissions.has('collaboration.customer_visibility.manage'))
    ) {
      throw new NotFoundException('Collaboration target not found.');
    }
    return this.createComment(context.id, type, id, input.body, visibility, user.id);
  }

  async listCommentsPortal(portal: PortalContext, type: string, id: string) {
    await requirePortalTarget(this.prisma, portal, type, id);
    return this.listComments(portal.organizationId, type, id, true);
  }

  async addCommentPortal(portal: PortalContext, type: string, id: string, input: CreateCommentDto) {
    await requirePortalTarget(this.prisma, portal, type, id);
    return this.createComment(
      portal.organizationId,
      type,
      id,
      input.body,
      'CUSTOMER',
      portal.userId,
      portal.id,
    );
  }

  async activity(context: OrganizationContext, type: string, id: string, cursor?: string) {
    await requireInternalTarget(this.prisma, context, type, id, 'view');
    return this.listActivity(context.id, type, id, false, cursor);
  }

  async portalActivity(portal: PortalContext, type: string, id: string, cursor?: string) {
    await requirePortalTarget(this.prisma, portal, type, id);
    return this.listActivity(portal.organizationId, type, id, true, cursor);
  }

  private async createComment(
    organizationId: string,
    type: string,
    id: string,
    body: string,
    visibility: 'INTERNAL' | 'CUSTOMER',
    userId: string,
    portalUserId?: string,
  ) {
    return this.prisma.$transaction(async (tx: any) => {
      const comment = await tx.comment.create({
        data: {
          organizationId,
          targetType: type,
          targetId: id,
          body,
          visibility,
          authorUserId: userId,
          portalUserId: portalUserId ?? null,
        },
        include: { author: { select: { displayName: true } } },
      });
      await tx.activity.create({
        data: {
          organizationId,
          targetType: type,
          targetId: id,
          kind: 'COMMENT',
          visibility,
          eventKey: 'collaboration.comment_created',
          actorUserId: userId,
          portalUserId: portalUserId ?? null,
          metadata: { commentId: comment.id },
        },
      });
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        eventKey: 'collaboration.comment_created',
        entityType: type.toLowerCase(),
        entityId: id,
        action: AuditAction.CREATE,
        after: { commentId: comment.id, visibility },
        ipHash: null,
      });
      return {
        id: comment.id,
        body: comment.body,
        visibility: comment.visibility,
        author: comment.author.displayName,
        createdAt: comment.createdAt.toISOString(),
      };
    });
  }

  private async listComments(
    organizationId: string,
    type: string,
    id: string,
    customerOnly: boolean,
  ) {
    const comments = await (this.prisma as any).comment.findMany({
      where: {
        organizationId,
        targetType: type,
        targetId: id,
        ...(customerOnly ? { visibility: 'CUSTOMER' } : {}),
      },
      include: { author: { select: { displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map((comment: any) => ({
      id: comment.id,
      body: comment.body,
      visibility: comment.visibility,
      author: comment.author.displayName,
      createdAt: comment.createdAt.toISOString(),
    }));
  }

  private async listActivity(
    organizationId: string,
    type: string,
    id: string,
    customerOnly: boolean,
    cursor?: string,
  ) {
    const parsed = cursor ? decodeCursor(cursor) : undefined;
    const rows = await (this.prisma as any).activity.findMany({
      where: {
        organizationId,
        targetType: type,
        targetId: id,
        ...(customerOnly ? { visibility: 'CUSTOMER' } : {}),
        ...(parsed
          ? {
              OR: [
                { occurredAt: { lt: parsed.occurredAt } },
                { occurredAt: parsed.occurredAt, id: { lt: parsed.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
    const page = rows.slice(0, 50);
    return {
      data: page.map((row: any) => ({
        id: row.id,
        kind: row.kind,
        eventKey: row.eventKey,
        visibility: row.visibility,
        occurredAt: row.occurredAt.toISOString(),
        metadata: row.metadata,
      })),
      nextCursor: rows.length > 50 ? encodeCursor(page.at(-1)) : null,
    };
  }
}

function encodeCursor(row: any) {
  return Buffer.from(
    JSON.stringify({ occurredAt: row.occurredAt.toISOString(), id: row.id }),
  ).toString('base64url');
}

function decodeCursor(value: string): { occurredAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed.id !== 'string' || Number.isNaN(Date.parse(parsed.occurredAt)))
      throw new Error('invalid');
    return { id: parsed.id, occurredAt: new Date(parsed.occurredAt) };
  } catch {
    throw new BadRequestException('Invalid activity cursor.');
  }
}
