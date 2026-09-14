import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { OrganizationRequest } from '../organizations/organization-context.js';
import { EntitlementsService } from './entitlements.service.js';

export const FEATURE_FLAG_KEY = 'platform:feature-flag';

/**
 * Declares the feature flag key that must resolve enabled for the caller's organization to reach a
 * handler. Pairs with `FeatureFlagGuard`, which most controllers add once at the class level
 * alongside `SessionGuard`/`OrganizationGuard` -- it is a no-op for any handler without this
 * decorator, so mixing already-shipped and flag-gated routes on the same controller is safe.
 *
 * An unknown, archived, or disabled flag fails closed (see `EntitlementsService.isFlagEnabled`), so
 * disabling or deleting a flag in the platform console is an immediate kill switch for every route
 * it gates -- no redeploy required.
 */
export const RequireFeatureFlag = (key: string): MethodDecorator =>
  SetMetadata(FEATURE_FLAG_KEY, key);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true;

    const request = context.switchToHttp().getRequest<OrganizationRequest>();
    const organizationId = request.organization?.id;
    // OrganizationGuard runs first (class-level guards run before handler-level ones) and sets
    // `request.organization`; a missing id here means that guard hasn't run, not that access should
    // be granted, so this fails closed rather than assuming the caller is authorized.
    if (!organizationId) {
      throw new ForbiddenException('This feature is not enabled for your organization.');
    }

    const enabled = await this.entitlements.isFlagEnabled(organizationId, key);
    if (!enabled) {
      throw new ForbiddenException('This feature is not enabled for your organization.');
    }
    return true;
  }
}
