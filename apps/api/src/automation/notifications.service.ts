import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus, UserStatus, type Prisma } from '@prisma/client';

import { EMAIL_JOB_NAMES } from '../jobs/email-job.js';
import { EmailQueueService } from '../jobs/email-queue.service.js';
import { PrismaService } from '../database/prisma.service.js';

export type NotificationInput = {
  organizationId: string;
  recipientUserId: string;
  eventKey: string;
  title: string;
  body?: string;
  href?: string;
  metadata?: Prisma.InputJsonObject;
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailQueueService,
  ) {}

  async list(organizationId: string, userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: {
        organizationId,
        recipientUserId: userId,
        ...(unreadOnly ? { status: NotificationStatus.UNREAD } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async unreadCount(organizationId: string, userId: string) {
    return this.prisma.notification.count({
      where: { organizationId, recipientUserId: userId, status: NotificationStatus.UNREAD },
    });
  }

  async markRead(organizationId: string, userId: string, notificationId: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, organizationId, recipientUserId: userId },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
    if (!updated.count) throw new NotFoundException('Notification not found.');
  }

  async markAllRead(organizationId: string, userId: string) {
    await this.prisma.notification.updateMany({
      where: { organizationId, recipientUserId: userId, status: NotificationStatus.UNREAD },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
  }

  async preferences(organizationId: string, userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { organizationId, userId },
      orderBy: { eventKey: 'asc' },
    });
  }

  async upsertPreference(
    organizationId: string,
    userId: string,
    eventKey: string,
    inAppEnabled: boolean,
    emailEnabled: boolean,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: { organizationId_userId_eventKey: { organizationId, userId, eventKey } },
      create: { organizationId, userId, eventKey, inAppEnabled, emailEnabled },
      update: { inAppEnabled, emailEnabled },
    });
  }

  /**
   * Creates the in-app row and enqueues the matching email, each independently gated by the
   * recipient's preference for this exact `eventKey` -- a recipient with no preference row yet gets
   * both by default, matching `upsertPreference`'s own defaults. Email is a best-effort side effect
   * outside `tx`'s atomicity the same way every other transactional email in this codebase is: if a
   * later action in the same caller's transaction rolls it back, an already-enqueued email cannot be
   * un-sent.
   */
  async create(tx: Prisma.TransactionClient, input: NotificationInput) {
    const [preference, recipient] = await Promise.all([
      tx.notificationPreference.findUnique({
        where: {
          organizationId_userId_eventKey: {
            organizationId: input.organizationId,
            userId: input.recipientUserId,
            eventKey: input.eventKey,
          },
        },
        select: { inAppEnabled: true, emailEnabled: true },
      }),
      tx.user.findUnique({
        where: { id: input.recipientUserId },
        select: { email: true, status: true },
      }),
    ]);

    if (recipient?.status === UserStatus.ACTIVE && (preference?.emailEnabled ?? true)) {
      const body = input.body ?? input.title;
      await this.email.enqueue(EMAIL_JOB_NAMES.automationNotification, {
        to: recipient.email,
        subject: input.title,
        text: body,
        html: `<p>${escapeHtml(body)}</p>`,
      });
    }

    if (preference && !preference.inAppEnabled) return null;
    return tx.notification.create({
      data: {
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        eventKey: input.eventKey,
        title: input.title,
        body: input.body,
        href: input.href,
        metadata: input.metadata ?? {},
      },
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
