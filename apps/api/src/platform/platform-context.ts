import { SetMetadata } from '@nestjs/common';
import type { PlatformRole } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/session.guard.js';

/**
 * The resolved platform-administration boundary for one request.
 *
 * Deliberately not an `OrganizationContext`: a platform administrator is not a member of anything,
 * holds no organization permissions, and must never acquire any by passing through this object.
 * Where a platform action concerns one tenant, the tenant is named by the route, and the service
 * reaches it directly rather than through a membership.
 */
export interface PlatformContext {
  /** `PlatformAdmin.id` — the grant, not the user. Platform audit rows reference this. */
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: PlatformRole;
}

export interface PlatformRequest extends AuthenticatedRequest {
  platform: PlatformContext;
}

/**
 * Privilege order. Each role can do everything the roles before it can.
 *
 * A single "is superadmin" bit was the obvious alternative and is the wrong one: it would force
 * every support engineer who needs to read an organization's status to also hold the ability to
 * retire a plan or flip a global feature flag.
 */
export const PLATFORM_ROLE_ORDER: readonly PlatformRole[] = ['SUPPORT', 'OPERATIONS', 'SUPERADMIN'];

export function platformRoleAtLeast(held: PlatformRole, required: PlatformRole): boolean {
  return PLATFORM_ROLE_ORDER.indexOf(held) >= PLATFORM_ROLE_ORDER.indexOf(required);
}

export const PLATFORM_ROLE_KEY = 'platform:role';

/**
 * Declares the minimum platform role a route requires. Stated on the route rather than checked
 * inside the service, so the boundary is visible at the edge and can be swept by a test that walks
 * the registered controllers — the same lesson the organization boundary matrix already encodes.
 */
export const RequirePlatformRole = (role: PlatformRole) => SetMetadata(PLATFORM_ROLE_KEY, role);
