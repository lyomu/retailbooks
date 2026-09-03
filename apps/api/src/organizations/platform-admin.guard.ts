import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/session.guard.js';

/**
 * Interim boundary for global (non-organization-scoped) administration endpoints, until Phase 12
 * ships the real platform-admin auth boundary. It must exist now because country packs are global
 * reference data: guarding their mutations with an organization permission key would let one
 * tenant's administrator mutate data every other tenant depends on, and guarding them with only
 * `SessionGuard` would let any authenticated user do the same.
 *
 * A deployment opts in by listing platform-administrator email addresses in
 * `PLATFORM_ADMIN_EMAILS` (comma-separated, case-insensitive). An unset or empty allowlist denies
 * everyone: a deployment that has not opted in has no platform administrators, rather than
 * silently trusting every authenticated session. Phase 12 replaces this guard with the superadmin
 * auth boundary and retires the environment variable.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const allowlist = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
    if (allowlist.length === 0) {
      throw new ForbiddenException('Platform administration is not enabled on this deployment.');
    }
    const email = request.auth?.user?.email?.trim().toLowerCase();
    if (!email || !allowlist.includes(email)) {
      throw new ForbiddenException('Platform administrator access is required.');
    }
    return true;
  }
}
