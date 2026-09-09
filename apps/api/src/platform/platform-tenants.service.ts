import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import { EntitlementsService } from './entitlements.service.js';
import { writePlatformAudit } from './platform-audit.js';
import type { PlatformContext } from './platform-context.js';
import type {
  AssignPlanDto,
  OrganizationSearchDto,
  UpdateUserStatusDto,
  UserSearchDto,
} from './platform.dto.js';

const DEFAULT_PAGE_SIZE = 25;

/**
 * Cross-tenant administration of organizations and the people in them.
 *
 * The hard rule this service exists to keep: **a platform administrator reads standing, never
 * books.** Every projection below is deliberately assembled field by field rather than by spreading
 * a record, and the usage figures are counts and dates — how many invoices exist, when the first
 * one was raised — never amounts, balances, or any row from the ledger. A support engineer can see
 * that a tenant is active and using invoicing; they cannot see what it invoiced or for how much.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async searchOrganizations(query: OrganizationSearchDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.OrganizationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.countryCode ? { countryCode: query.countryCode } : {}),
      ...(query.planKey ? { subscription: { plan: { key: query.planKey } } } : {}),
      ...(query.query
        ? {
            OR: [
              { legalName: { contains: query.query, mode: 'insensitive' } },
              { tradingName: { contains: query.query, mode: 'insensitive' } },
              { slug: { contains: query.query, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: new Date(`${query.createdFrom}T00:00:00.000Z`) } : {}),
              ...(query.createdTo
                ? {
                    lt: new Date(
                      new Date(`${query.createdTo}T00:00:00.000Z`).getTime() + 86_400_000,
                    ),
                  }
                : {}),
            },
          }
        : {}),
    };

    const [totalRows, rows] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          legalName: true,
          tradingName: true,
          slug: true,
          countryCode: true,
          baseCurrency: true,
          status: true,
          suspendedAt: true,
          suspendedReason: true,
          createdAt: true,
          createdBy: { select: { email: true, displayName: true } },
          subscription: { select: { status: true, plan: { select: { key: true, name: true } } } },
          _count: { select: { members: true } },
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.tradingName ?? row.legalName,
        legalName: row.legalName,
        slug: row.slug,
        countryCode: row.countryCode,
        baseCurrency: row.baseCurrency,
        status: row.status,
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
        suspendedReason: row.suspendedReason,
        ownerEmail: row.createdBy.email,
        ownerName: row.createdBy.displayName,
        planKey: row.subscription?.plan.key ?? null,
        planName: row.subscription?.plan.name ?? null,
        subscriptionStatus: row.subscription?.status ?? null,
        memberCount: row._count.members,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: { page, pageSize, totalRows },
    };
  }

  async organizationDetail(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        legalName: true,
        tradingName: true,
        slug: true,
        countryCode: true,
        baseCurrency: true,
        locale: true,
        timeZone: true,
        status: true,
        suspendedAt: true,
        suspendedReason: true,
        suspendedBy: { select: { email: true } },
        onboardingStep: true,
        onboardingCompletedAt: true,
        createdAt: true,
        createdBy: { select: { id: true, email: true, displayName: true } },
        members: {
          where: { status: 'ACTIVE' },
          select: {
            status: true,
            role: { select: { key: true, name: true } },
            user: { select: { id: true, email: true, displayName: true, status: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
      },
    });
    if (!organization) throw new NotFoundException('Organization not found.');

    return {
      id: organization.id,
      name: organization.tradingName ?? organization.legalName,
      legalName: organization.legalName,
      slug: organization.slug,
      countryCode: organization.countryCode,
      baseCurrency: organization.baseCurrency,
      locale: organization.locale,
      timeZone: organization.timeZone,
      status: organization.status,
      suspendedAt: organization.suspendedAt?.toISOString() ?? null,
      suspendedReason: organization.suspendedReason,
      suspendedBy: organization.suspendedBy?.email ?? null,
      onboardingStep: organization.onboardingStep,
      onboardingCompletedAt: organization.onboardingCompletedAt?.toISOString() ?? null,
      createdAt: organization.createdAt.toISOString(),
      owner: organization.createdBy,
      members: organization.members.map((member) => ({
        userId: member.user.id,
        email: member.user.email,
        displayName: member.user.displayName,
        userStatus: member.user.status,
        roleKey: member.role.key,
        roleName: member.role.name,
        membershipStatus: member.status,
      })),
      usage: await this.usage(organizationId),
      entitlements: await this.entitlements.forOrganization(organizationId),
    };
  }

  /**
   * Adoption signals only. Every figure here is a count or a date — never a monetary amount, a
   * balance, or a ledger row. That constraint is the reason this method exists separately rather
   * than being folded into a generic "organization stats" query someone could widen later.
   */
  private async usage(organizationId: string) {
    const [
      invoices,
      firstInvoice,
      bills,
      journals,
      reconciliations,
      projects,
      adjustments,
      portalUsers,
    ] = await Promise.all([
      this.prisma.invoice.count({ where: { organizationId, status: { not: 'DRAFT' } } }),
      this.prisma.invoice.findFirst({
        where: { organizationId, issueDate: { not: null } },
        orderBy: { issueDate: 'asc' },
        select: { issueDate: true },
      }),
      this.prisma.bill.count({ where: { organizationId } }),
      this.prisma.journal.count({ where: { organizationId, status: 'POSTED' } }),
      this.prisma.reconciliation.count({ where: { organizationId } }),
      this.prisma.project.count({ where: { organizationId } }),
      this.prisma.inventoryAdjustment.count({ where: { organizationId } }),
      this.prisma.portalUser.count({ where: { organizationId, status: 'ACTIVE' } }),
    ]);
    return {
      issuedInvoices: invoices,
      firstInvoiceAt: firstInvoice?.issueDate?.toISOString() ?? null,
      bills,
      postedJournals: journals,
      reconciliations,
      projects,
      inventoryAdjustments: adjustments,
      portalUsers,
    };
  }

  /**
   * Suspension blocks access and changes nothing else. No row is deleted, detached, or rewritten:
   * the tenant's books are exactly as they were, and reactivation restores access to them
   * untouched. That is why this is a status change plus three metadata columns rather than any kind
   * of teardown.
   */
  async suspendOrganization(
    actor: PlatformContext,
    organizationId: string,
    reason: string,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, status: true, legalName: true },
      });
      if (!existing) throw new NotFoundException('Organization not found.');
      if (existing.status === 'SUSPENDED') {
        throw new BadRequestException('This organization is already suspended.');
      }
      const updated = await tx.organization.update({
        where: { id: organizationId },
        data: {
          status: 'SUSPENDED',
          suspendedAt: new Date(),
          suspendedReason: reason,
          suspendedByUserId: actor.userId,
        },
        select: { id: true, status: true, suspendedAt: true, suspendedReason: true },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.organization_suspended',
        targetType: 'organization',
        targetId: organizationId,
        organizationId,
        reason,
        before: { status: existing.status },
        after: { status: updated.status },
        ipHash,
      });
      return {
        id: updated.id,
        status: updated.status,
        suspendedAt: updated.suspendedAt?.toISOString() ?? null,
        suspendedReason: updated.suspendedReason,
      };
    });
  }

  async reactivateOrganization(
    actor: PlatformContext,
    organizationId: string,
    reason: string | undefined,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, status: true, suspendedReason: true, onboardingCompletedAt: true },
      });
      if (!existing) throw new NotFoundException('Organization not found.');
      if (existing.status !== 'SUSPENDED') {
        throw new BadRequestException('Only a suspended organization can be reactivated.');
      }
      // An organization suspended before it finished onboarding goes back to DRAFT, not ACTIVE:
      // reactivation restores the state it was in, and finalization is what makes a tenant active.
      const restored = existing.onboardingCompletedAt ? 'ACTIVE' : 'DRAFT';
      const updated = await tx.organization.update({
        where: { id: organizationId },
        data: {
          status: restored,
          suspendedAt: null,
          suspendedReason: null,
          suspendedByUserId: null,
        },
        select: { id: true, status: true },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.organization_reactivated',
        targetType: 'organization',
        targetId: organizationId,
        organizationId,
        reason: reason ?? null,
        before: { status: 'SUSPENDED', suspendedReason: existing.suspendedReason },
        after: { status: updated.status },
        ipHash,
      });
      return { id: updated.id, status: updated.status };
    });
  }

  async assignPlan(
    actor: PlatformContext,
    organizationId: string,
    input: AssignPlanDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [organization, plan] = await Promise.all([
        tx.organization.findUnique({
          where: { id: organizationId },
          select: { id: true, subscription: { select: { planId: true, status: true } } },
        }),
        tx.plan.findUnique({
          where: { id: input.planId },
          select: { id: true, key: true, trialDays: true },
        }),
      ]);
      if (!organization) throw new NotFoundException('Organization not found.');
      if (!plan) throw new NotFoundException('Plan not found.');

      const status = input.status ?? 'ACTIVE';
      const trialEndsAt = input.trialEndsAt
        ? new Date(`${input.trialEndsAt}T00:00:00.000Z`)
        : status === 'TRIALING' && plan.trialDays > 0
          ? new Date(Date.now() + plan.trialDays * 86_400_000)
          : null;

      const subscription = await tx.organizationSubscription.upsert({
        where: { organizationId },
        update: { planId: plan.id, status, trialEndsAt, cancelledAt: null },
        create: { organizationId, planId: plan.id, status, trialEndsAt },
        select: { planId: true, status: true, trialEndsAt: true },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_assigned',
        targetType: 'organization',
        targetId: organizationId,
        organizationId,
        reason: input.reason ?? null,
        before: organization.subscription ?? undefined,
        after: { planId: subscription.planId, status: subscription.status },
        ipHash,
      });
      return {
        planId: subscription.planId,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      };
    });
  }

  async searchUsers(query: UserSearchDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.query
        ? {
            OR: [
              { email: { contains: query.query, mode: 'insensitive' } },
              { displayName: { contains: query.query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [totalRows, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          emailVerifiedAt: true,
          createdAt: true,
          _count: { select: { memberships: true } },
        },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        status: row.status,
        emailVerified: row.emailVerifiedAt !== null,
        membershipCount: row._count.memberships,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: { page, pageSize, totalRows },
    };
  }

  async userDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        platformAdmin: { select: { role: true, status: true } },
        memberships: {
          select: {
            status: true,
            role: { select: { key: true, name: true } },
            organization: {
              select: { id: true, legalName: true, tradingName: true, status: true },
            },
          },
          take: 100,
        },
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: { createdAt: true, userAgent: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        securityEvents: {
          select: { eventKey: true, severity: true, occurredAt: true },
          orderBy: { occurredAt: 'desc' },
          take: 25,
        },
      },
    });
    if (!user) throw new NotFoundException('User not found.');
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
      platformRole: user.platformAdmin?.status === 'ACTIVE' ? user.platformAdmin.role : null,
      memberships: user.memberships.map((membership) => ({
        organizationId: membership.organization.id,
        organizationName: membership.organization.tradingName ?? membership.organization.legalName,
        organizationStatus: membership.organization.status,
        roleKey: membership.role.key,
        roleName: membership.role.name,
        membershipStatus: membership.status,
      })),
      activeSessions: user.sessions.map((session) => ({
        createdAt: session.createdAt.toISOString(),
        userAgent: session.userAgent,
      })),
      securityEvents: user.securityEvents.map((event) => ({
        eventKey: event.eventKey,
        severity: event.severity,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }

  async updateUserStatus(
    actor: PlatformContext,
    userId: string,
    input: UpdateUserStatusDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true },
      });
      if (!existing) throw new NotFoundException('User not found.');
      if (existing.status === input.status) {
        throw new BadRequestException(`This account is already ${input.status}.`);
      }
      // Suspending an account revokes its live sessions; leaving them valid would make the
      // suspension take effect only when the current session happened to expire.
      if (input.status !== 'ACTIVE') {
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { status: input.status },
        select: { id: true, status: true },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.user_status_changed',
        targetType: 'user',
        targetId: userId,
        reason: input.reason,
        before: { status: existing.status },
        after: { status: updated.status },
        ipHash,
      });
      return updated;
    });
  }
}
