import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { PlatformAccessService } from './platform-access.service.js';
import {
  PLATFORM_ROLE_KEY,
  platformRoleAtLeast,
  type PlatformRequest,
} from './platform-context.js';

/**
 * The platform-administration boundary. Runs after `SessionGuard`, resolves the caller's grant, and
 * enforces the minimum role the route declared with `@RequirePlatformRole`.
 *
 * Failures are `403`, not the `404` the tenant guards return. The reasoning differs: a tenant route
 * answers 404 so an outsider cannot learn that an organization exists. A platform route reveals
 * nothing by admitting that platform administration exists — the console is not a secret — and a
 * flat 403 is far easier for an operator who has genuinely lost their grant to diagnose.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly access: PlatformAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth?.user) throw new ForbiddenException('Platform administrator access required.');

    const resolved = await this.access.resolve(request.auth.user);
    if (!resolved) throw new ForbiddenException('Platform administrator access required.');

    const required = this.reflector.getAllAndOverride<PlatformRole | undefined>(PLATFORM_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // A route that declares no minimum still requires a grant; SUPPORT is the floor.
    if (required && !platformRoleAtLeast(resolved.role, required)) {
      throw new ForbiddenException(`This action requires the ${required} platform role.`);
    }

    (request as PlatformRequest).platform = resolved;
    return true;
  }
}
