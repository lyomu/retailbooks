import { Injectable, NotFoundException } from '@nestjs/common';
import type { FeatureFlagScope } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface ResolvedEntitlement {
  key: string;
  enabled: boolean;
  /** Null means no limit, which is a different statement from a limit of zero. */
  limitValue: number | null;
}

export interface ResolvedFlag {
  key: string;
  enabled: boolean;
  /** Which rule decided the answer, so an operator can see *why* a tenant has a feature. */
  decidedBy: FeatureFlagScope | 'DEFAULT';
}

export interface OrganizationEntitlements {
  organizationId: string;
  plan: { key: string; name: string } | null;
  subscription: { status: string; trialEndsAt: string | null } | null;
  entitlements: ResolvedEntitlement[];
  flags: ResolvedFlag[];
}

/**
 * Least to most specific. The resolver reads this order directly, so adding a scope means deciding
 * where it sits in the precedence chain rather than adding another branch somewhere.
 */
const SCOPE_PRECEDENCE: readonly FeatureFlagScope[] = ['GLOBAL', 'COUNTRY', 'PLAN', 'ORGANIZATION'];

/**
 * Resolves what one organization is actually allowed to do: its plan's entitlements, plus every
 * feature flag evaluated against the targeting rules.
 *
 * Two properties are load-bearing.
 *
 * **Most specific wins.** Organization beats plan, beats country, beats global, beats the flag's own
 * default. The order lives in `SCOPE_PRECEDENCE` rather than in a chain of conditionals, so adding a
 * scope forces an explicit decision about where it sits.
 *
 * **Resolution is a pure function of stored rows.** Nothing here writes or caches. That is what
 * makes it safe to call on a request path later, or to move behind a cache, without changing what
 * any tenant sees.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrganization(organizationId: string): Promise<OrganizationEntitlements> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        countryCode: true,
        subscription: {
          select: {
            status: true,
            trialEndsAt: true,
            plan: {
              select: {
                id: true,
                key: true,
                name: true,
                entitlements: { select: { key: true, enabled: true, limitValue: true } },
              },
            },
          },
        },
      },
    });
    if (!organization) throw new NotFoundException('Organization not found.');

    const subscription = organization.subscription;
    const plan = subscription?.plan ?? null;

    const flags = await this.prisma.featureFlag.findMany({
      where: { status: 'ACTIVE' },
      select: {
        key: true,
        defaultEnabled: true,
        rules: {
          where: {
            OR: [
              { scope: 'GLOBAL' },
              { scope: 'COUNTRY', countryCode: organization.countryCode },
              ...(plan ? [{ scope: 'PLAN' as const, planId: plan.id }] : []),
              { scope: 'ORGANIZATION', organizationId },
            ],
          },
          select: { scope: true, enabled: true },
        },
      },
      orderBy: { key: 'asc' },
    });

    return {
      organizationId,
      plan: plan ? { key: plan.key, name: plan.name } : null,
      subscription: subscription
        ? {
            status: subscription.status,
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
          }
        : null,
      entitlements: (plan?.entitlements ?? [])
        .map((entitlement) => ({
          key: entitlement.key,
          enabled: entitlement.enabled,
          limitValue: entitlement.limitValue,
        }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      flags: flags.map((flag) => resolveFlag(flag.key, flag.defaultEnabled, flag.rules)),
    };
  }

  /**
   * Answers one flag for one organization, without resolving every other flag and the whole plan
   * to do it. This is the entry point application code would use on a request path.
   */
  async isFlagEnabled(organizationId: string, key: string): Promise<boolean> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { countryCode: true, subscription: { select: { planId: true } } },
    });
    if (!organization) return false;

    const flag = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: {
        key: true,
        status: true,
        defaultEnabled: true,
        rules: {
          where: {
            OR: [
              { scope: 'GLOBAL' },
              { scope: 'COUNTRY', countryCode: organization.countryCode },
              ...(organization.subscription
                ? [{ scope: 'PLAN' as const, planId: organization.subscription.planId }]
                : []),
              { scope: 'ORGANIZATION', organizationId },
            ],
          },
          select: { scope: true, enabled: true },
        },
      },
    });
    // An unknown or archived flag is off. Failing closed means removing a flag turns its feature
    // off everywhere rather than on everywhere.
    if (!flag || flag.status !== 'ACTIVE') return false;
    return resolveFlag(flag.key, flag.defaultEnabled, flag.rules).enabled;
  }

  /**
   * Explains one flag across every organization-shaped input, for the console's preview control.
   * Takes the country and plan directly rather than an organization id so an operator can ask
   * "what would a Kenyan tenant on Growth see?" before any such tenant exists.
   */
  async preview(input: {
    flagKey: string;
    countryCode?: string;
    planId?: string;
    organizationId?: string;
  }): Promise<ResolvedFlag> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key: input.flagKey },
      select: {
        key: true,
        defaultEnabled: true,
        rules: { select: { scope: true, enabled: true, countryCode: true, planId: true, organizationId: true } },
      },
    });
    if (!flag) throw new NotFoundException('Feature flag not found.');

    const matching = flag.rules.filter((rule) => {
      switch (rule.scope) {
        case 'GLOBAL':
          return true;
        case 'COUNTRY':
          return Boolean(input.countryCode) && rule.countryCode === input.countryCode;
        case 'PLAN':
          return Boolean(input.planId) && rule.planId === input.planId;
        case 'ORGANIZATION':
          return Boolean(input.organizationId) && rule.organizationId === input.organizationId;
      }
    });
    return resolveFlag(flag.key, flag.defaultEnabled, matching);
  }
}

/**
 * Picks the winning rule. The database already guarantees at most one rule per flag per target, so
 * this only has to choose between scopes, never between two rules of the same scope.
 */
function resolveFlag(
  key: string,
  defaultEnabled: boolean,
  rules: ReadonlyArray<{ scope: FeatureFlagScope; enabled: boolean }>,
): ResolvedFlag {
  let winner: { scope: FeatureFlagScope; enabled: boolean } | null = null;
  for (const rule of rules) {
    const rank = SCOPE_PRECEDENCE.indexOf(rule.scope);
    const held = winner ? SCOPE_PRECEDENCE.indexOf(winner.scope) : -1;
    if (rank > held) winner = rule;
  }
  return {
    key,
    enabled: winner ? winner.enabled : defaultEnabled,
    decidedBy: winner ? winner.scope : 'DEFAULT',
  };
}
