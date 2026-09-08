import { Injectable, Logger } from '@nestjs/common';
import type { PlatformRole } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { PlatformContext } from './platform-context.js';

/**
 * Resolves the platform-administration boundary, and owns the one-time bootstrap that creates the
 * first grant.
 *
 * Phase 8 shipped `PlatformAdminGuard` reading a `PLATFORM_ADMIN_EMAILS` environment allowlist, and
 * its own comment named Phase 12 as the point at which that is replaced. It is replaced here — but
 * not deleted, because a fresh deployment has no grants and no way to create one: every route that
 * could grant one already requires a grant. The allowlist is therefore kept as a **bootstrap only**
 * path, with two properties that make it safe to keep:
 *
 *   1. It is consulted only while no active grant exists anywhere. The moment one does, the
 *      allowlist is ignored entirely, so it cannot be used to quietly re-enter later or to escalate
 *      an existing SUPPORT grant.
 *   2. It mints a real, audited `PlatformAdmin` row rather than conferring authority by itself.
 *      After bootstrap the database is the only authority, and the environment variable can be
 *      removed from the deployment.
 *
 * A deployment with neither a grant nor an allowlist entry has no platform administrators. That is
 * the intended answer, not a misconfiguration to work around: an empty allowlist denies everyone.
 */
@Injectable()
export class PlatformAccessService {
  private readonly logger = new Logger(PlatformAccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the caller's grant, bootstrapping the first one if the deployment has none. */
  async resolve(user: PublicUser): Promise<PlatformContext | null> {
    const existing = await this.prisma.platformAdmin.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { id: true, userId: true, role: true },
    });
    if (existing) {
      return {
        id: existing.id,
        userId: existing.userId,
        email: user.email,
        displayName: user.displayName,
        role: existing.role,
      };
    }
    return this.bootstrap(user);
  }

  private async bootstrap(user: PublicUser): Promise<PlatformContext | null> {
    if (!this.allowlist().includes(user.email.trim().toLowerCase())) return null;

    // Only while the deployment has no administrator at all. Checked inside the same transaction as
    // the insert so two simultaneous first sign-ins cannot both bootstrap.
    const granted = await this.prisma.$transaction(async (tx) => {
      const anyActive = await tx.platformAdmin.count({ where: { status: 'ACTIVE' } });
      if (anyActive > 0) return null;
      return tx.platformAdmin.upsert({
        where: { userId: user.id },
        update: { status: 'ACTIVE', role: 'SUPERADMIN', revokedAt: null },
        create: {
          userId: user.id,
          role: 'SUPERADMIN',
          note: 'Bootstrapped from PLATFORM_ADMIN_EMAILS on a deployment with no administrators.',
        },
        select: { id: true, userId: true, role: true },
      });
    });
    if (!granted) return null;

    this.logger.warn(
      `Bootstrapped platform administrator ${user.email} from PLATFORM_ADMIN_EMAILS. ` +
        'The allowlist is now inert; remove it from the deployment.',
    );
    return {
      id: granted.id,
      userId: granted.userId,
      email: user.email,
      displayName: user.displayName,
      role: granted.role,
    };
  }

  private allowlist(): string[] {
    return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }

  async listAdmins() {
    const admins = await this.prisma.platformAdmin.findMany({
      include: {
        user: { select: { email: true, displayName: true, status: true } },
        grantedBy: { select: { email: true, displayName: true } },
      },
      orderBy: [{ status: 'asc' }, { grantedAt: 'desc' }],
    });
    return admins.map((admin) => ({
      id: admin.id,
      userId: admin.userId,
      email: admin.user.email,
      displayName: admin.user.displayName,
      role: admin.role,
      status: admin.status,
      note: admin.note,
      grantedBy: admin.grantedBy?.email ?? null,
      grantedAt: admin.grantedAt.toISOString(),
      revokedAt: admin.revokedAt?.toISOString() ?? null,
    }));
  }

  async grant(actor: PlatformContext, email: string, role: PlatformRole, note?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    // Non-disclosure: whether an address has a RetailBooks account is not something this endpoint
    // confirms, so an unknown address and a known one fail the same way.
    if (!user) return null;
    return this.prisma.platformAdmin.upsert({
      where: { userId: user.id },
      update: { role, status: 'ACTIVE', revokedAt: null, grantedByUserId: actor.userId, note },
      create: { userId: user.id, role, grantedByUserId: actor.userId, note },
      select: { id: true, userId: true, role: true, status: true },
    });
  }

  async revoke(platformAdminId: string) {
    const result = await this.prisma.platformAdmin.updateMany({
      where: { id: platformAdminId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return result.count === 1;
  }

  /** The number of active SUPERADMIN grants, so the last one cannot be revoked by accident. */
  async activeSuperadmins(): Promise<number> {
    return this.prisma.platformAdmin.count({ where: { status: 'ACTIVE', role: 'SUPERADMIN' } });
  }
}
