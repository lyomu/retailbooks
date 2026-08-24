import { SetMetadata } from '@nestjs/common';
import type { OnboardingStep, OrganizationStatus } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/session.guard.js';
import type { PermissionKey } from './permission-catalog.js';

export const PERMISSION_KEY = 'organization:permission';

/**
 * Declares the single permission key required to reach a handler. A handler with no
 * `@RequirePermission` is reachable by any active member of the organization — that must be a
 * deliberate choice, not an oversight.
 */
export const RequirePermission = (key: PermissionKey): MethodDecorator =>
  SetMetadata(PERMISSION_KEY, key);

/** The caller's role within the organization -- one row from that organization's own `Role` table. */
export interface MemberRole {
  id: string;
  key: string;
  name: string;
  isOwnerRole: boolean;
}

export interface OrganizationContext {
  id: string;
  legalName: string;
  slug: string;
  status: OrganizationStatus;
  onboardingStep: OnboardingStep;
  role: MemberRole;
  permissions: ReadonlySet<PermissionKey>;
}

export interface OrganizationRequest extends AuthenticatedRequest {
  organization: OrganizationContext;
}
