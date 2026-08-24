import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, OrganizationStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import type { OrganizationContext } from './organization-context.js';
import { PermissionsService } from './permissions.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A single, deliberately dull message. Non-members and unknown identifiers get the same answer so
 * an organization identifier cannot be probed for existence.
 */
const NOT_FOUND = 'Organization not found.';

/**
 * The only place an organization identifier becomes trusted.
 *
 * Callers hand in an identifier that came from the client; this service answers with a context only
 * when the authenticated user holds an active membership of that organization.
 */
@Injectable()
export class OrganizationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async requireMembership(userId: string, organizationId: string): Promise<OrganizationContext> {
    if (!UUID_PATTERN.test(organizationId)) throw new NotFoundException(NOT_FOUND);

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: {
        organization: {
          select: { id: true, legalName: true, slug: true, status: true, onboardingStep: true },
        },
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException(NOT_FOUND);
    }
    if (membership.organization.status === OrganizationStatus.SUSPENDED) {
      throw new ForbiddenException('This organization is suspended.');
    }

    const permissions = await this.permissions.resolveEffectivePermissions(
      membership.organization.id,
      membership.role,
    );

    return {
      id: membership.organization.id,
      legalName: membership.organization.legalName,
      slug: membership.organization.slug,
      status: membership.organization.status,
      onboardingStep: membership.organization.onboardingStep,
      role: membership.role,
      permissions,
    };
  }

  /** Resolves the organization to work in when the caller did not name one. */
  async resolveDefaultOrganizationId(
    userId: string,
    preferredId?: string | null,
  ): Promise<string | null> {
    if (preferredId && UUID_PATTERN.test(preferredId)) {
      const preferred = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: preferredId, userId } },
        select: { status: true, organization: { select: { status: true } } },
      });
      if (
        preferred?.status === MembershipStatus.ACTIVE &&
        preferred.organization.status !== OrganizationStatus.SUSPENDED
      ) {
        return preferredId;
      }
    }

    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        organization: { status: { not: OrganizationStatus.SUSPENDED } },
      },
      orderBy: { joinedAt: 'asc' },
      select: { organizationId: true, organization: { select: { status: true } } },
    });

    const live = memberships.find(
      (membership) => membership.organization.status === OrganizationStatus.ACTIVE,
    );
    return live?.organizationId ?? memberships[0]?.organizationId ?? null;
  }
}
