import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { PortalContext } from './portal-context.js';

const inaccessible = () => new NotFoundException('Portal account not found.');

@Injectable()
export class PortalAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(userId: string, portalUserId: string): Promise<PortalContext> {
    // The Phase 11 delegates arrive with the Phase 11 Prisma client generation. Keeping the cast
    // local lets the code-first pass be reviewed before the explicitly deferred generation step.
    const grant = await (this.prisma as any).portalUser.findFirst({
      where: { id: portalUserId, userId, status: 'ACTIVE' },
      select: {
        id: true,
        organizationId: true,
        contactId: true,
        userId: true,
        organization: { select: { legalName: true, tradingName: true } },
        contact: { select: { displayName: true, type: true } },
      },
    });
    if (!grant || grant.contact.type !== 'CUSTOMER') throw inaccessible();
    return {
      id: grant.id,
      organizationId: grant.organizationId,
      contactId: grant.contactId,
      userId: grant.userId,
      organizationName: grant.organization.tradingName ?? grant.organization.legalName,
      contactName: grant.contact.displayName,
    };
  }
}
