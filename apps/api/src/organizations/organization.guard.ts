import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getCookie } from '../auth/request-context.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { OrganizationAccessService } from './organization-access.service.js';
import { PERMISSION_KEY, type OrganizationRequest } from './organization-context.js';
import { ACTIVE_ORGANIZATION_COOKIE } from './organization-cookie.js';
import type { PermissionKey } from './permission-catalog.js';

/**
 * Runs after `SessionGuard`. The client may name an organization through the route, a header, or
 * the active-organization cookie, but the identifier is never trusted on its own: access is
 * resolved from the authenticated user's membership, and a non-member is answered as if the
 * organization does not exist.
 */
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new UnauthorizedException('Sign in to continue.');

    const requested =
      singleValue(request.params.organizationId) ??
      singleValue(request.headers['x-organization-id']) ??
      getCookie(request, ACTIVE_ORGANIZATION_COOKIE);

    if (!requested) throw new NotFoundException('Organization not found.');

    const organization = await this.access.requireMembership(request.auth.user.id, requested);
    (request as OrganizationRequest).organization = organization;

    const requiredPermission = this.reflector.getAllAndOverride<PermissionKey | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredPermission && !organization.permissions.has(requiredPermission)) {
      throw new ForbiddenException('Your role does not allow this action.');
    }

    return true;
  }
}

/** Express allows repeated params and headers; a repeated organization id is treated as absent. */
function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
