import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { writePlatformAudit } from './platform-audit.js';
import type { PlatformContext } from './platform-context.js';
import type {
  CreateFeatureFlagDto,
  CreatePlanDto,
  UpdateFeatureFlagDto,
  UpdatePlanDto,
  UpsertEntitlementDto,
  UpsertFlagRuleDto,
} from './platform.dto.js';

/**
 * Global reference data a superadmin owns: plans, their entitlements, and feature flags with their
 * targeting rules. Every tenant depends on these rows, which is why they sit behind the highest
 * platform role rather than an organization permission.
 */
@Injectable()
export class PlatformCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      include: {
        entitlements: { orderBy: { key: 'asc' } },
        _count: { select: { subscriptions: true } },
      },
    });
    return plans.map((plan) => ({
      id: plan.id,
      key: plan.key,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      isDefault: plan.isDefault,
      trialDays: plan.trialDays,
      priceMinor: plan.priceMinor.toString(),
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      sortOrder: plan.sortOrder,
      subscriberCount: plan._count.subscriptions,
      entitlements: plan.entitlements.map((entitlement) => ({
        key: entitlement.key,
        enabled: entitlement.enabled,
        limitValue: entitlement.limitValue,
      })),
    }));
  }

  async createPlan(actor: PlatformContext, input: CreatePlanDto, ipHash: string | null) {
    const existing = await this.prisma.plan.findUnique({
      where: { key: input.key },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A plan with that key already exists.');

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          trialDays: input.trialDays ?? 0,
          priceMinor: BigInt(input.priceMinor ?? '0'),
          currency: input.currency ?? 'USD',
          billingInterval: input.billingInterval ?? 'MONTHLY',
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_created',
        targetType: 'plan',
        targetId: plan.id,
        after: { key: plan.key, name: plan.name },
        ipHash,
      });
      return { id: plan.id, key: plan.key };
    });
  }

  async updatePlan(
    actor: PlatformContext,
    planId: string,
    input: UpdatePlanDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.plan.findUnique({ where: { id: planId } });
      if (!existing) throw new NotFoundException('Plan not found.');
      if (input.status === 'RETIRED') {
        const subscribers = await tx.organizationSubscription.count({ where: { planId } });
        // Retiring a plan that tenants are on would leave them pointing at a tier nobody can
        // reason about. Move them first; the console offers that as an explicit action.
        if (subscribers > 0) {
          throw new BadRequestException(
            `${subscribers} organization(s) are still on this plan. Move them before retiring it.`,
          );
        }
      }
      // The database enforces a single default with a partial unique index, so the previous holder
      // has to be cleared in the same transaction rather than relying on write order.
      if (input.isDefault === true) {
        await tx.plan.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      if (input.isDefault === false && existing.isDefault) {
        throw new BadRequestException(
          'Make another plan the default rather than leaving the platform without one.',
        );
      }
      const updated = await tx.plan.update({
        where: { id: planId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
          ...(input.priceMinor !== undefined ? { priceMinor: BigInt(input.priceMinor) } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.billingInterval !== undefined ? { billingInterval: input.billingInterval } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.plan_updated',
        targetType: 'plan',
        targetId: planId,
        before: { status: existing.status, isDefault: existing.isDefault, name: existing.name },
        after: { status: updated.status, isDefault: updated.isDefault, name: updated.name },
        ipHash,
      });
      return { id: updated.id, key: updated.key, status: updated.status };
    });
  }

  async upsertEntitlement(
    actor: PlatformContext,
    planId: string,
    input: UpsertEntitlementDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({ where: { id: planId }, select: { id: true } });
      if (!plan) throw new NotFoundException('Plan not found.');
      const before = await tx.planEntitlement.findUnique({
        where: { planId_key: { planId, key: input.key } },
        select: { enabled: true, limitValue: true },
      });
      const entitlement = await tx.planEntitlement.upsert({
        where: { planId_key: { planId, key: input.key } },
        update: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          // `limitValue` is tri-state: absent leaves it alone, null means unlimited, a number caps.
          ...(input.limitValue !== undefined ? { limitValue: input.limitValue } : {}),
        },
        create: {
          planId,
          key: input.key,
          enabled: input.enabled ?? true,
          limitValue: input.limitValue ?? null,
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.entitlement_updated',
        targetType: 'plan_entitlement',
        targetId: entitlement.id,
        before: before ?? undefined,
        after: { key: entitlement.key, enabled: entitlement.enabled, limitValue: entitlement.limitValue },
        ipHash,
      });
      return {
        key: entitlement.key,
        enabled: entitlement.enabled,
        limitValue: entitlement.limitValue,
      };
    });
  }

  async removeEntitlement(
    actor: PlatformContext,
    planId: string,
    key: string,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.planEntitlement.findUnique({
        where: { planId_key: { planId, key } },
      });
      if (!existing) throw new NotFoundException('Entitlement not found.');
      await tx.planEntitlement.delete({ where: { id: existing.id } });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.entitlement_removed',
        targetType: 'plan_entitlement',
        targetId: existing.id,
        before: { key: existing.key, enabled: existing.enabled, limitValue: existing.limitValue },
        ipHash,
      });
    });
  }

  async listFlags() {
    const flags = await this.prisma.featureFlag.findMany({
      orderBy: [{ status: 'asc' }, { key: 'asc' }],
      include: {
        rules: {
          orderBy: { scope: 'asc' },
          include: {
            plan: { select: { key: true, name: true } },
            organization: { select: { legalName: true, tradingName: true } },
          },
        },
      },
    });
    return flags.map((flag) => ({
      id: flag.id,
      key: flag.key,
      name: flag.name,
      description: flag.description,
      defaultEnabled: flag.defaultEnabled,
      status: flag.status,
      rules: flag.rules.map((rule) => ({
        id: rule.id,
        scope: rule.scope,
        enabled: rule.enabled,
        note: rule.note,
        countryCode: rule.countryCode,
        planId: rule.planId,
        planName: rule.plan?.name ?? null,
        organizationId: rule.organizationId,
        organizationName: rule.organization
          ? (rule.organization.tradingName ?? rule.organization.legalName)
          : null,
      })),
    }));
  }

  async createFlag(actor: PlatformContext, input: CreateFeatureFlagDto, ipHash: string | null) {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: input.key },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A feature flag with that key already exists.');
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          defaultEnabled: input.defaultEnabled ?? false,
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_created',
        targetType: 'feature_flag',
        targetId: flag.id,
        after: { key: flag.key, defaultEnabled: flag.defaultEnabled },
        ipHash,
      });
      return { id: flag.id, key: flag.key };
    });
  }

  async updateFlag(
    actor: PlatformContext,
    flagId: string,
    input: UpdateFeatureFlagDto,
    ipHash: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlag.findUnique({ where: { id: flagId } });
      if (!existing) throw new NotFoundException('Feature flag not found.');
      const updated = await tx.featureFlag.update({
        where: { id: flagId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.defaultEnabled !== undefined ? { defaultEnabled: input.defaultEnabled } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_updated',
        targetType: 'feature_flag',
        targetId: flagId,
        before: { defaultEnabled: existing.defaultEnabled, status: existing.status },
        after: { defaultEnabled: updated.defaultEnabled, status: updated.status },
        ipHash,
      });
      return { id: updated.id, key: updated.key, status: updated.status };
    });
  }

  async upsertFlagRule(
    actor: PlatformContext,
    flagId: string,
    input: UpsertFlagRuleDto,
    ipHash: string | null,
  ) {
    assertScopeTarget(input);
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.findUnique({ where: { id: flagId }, select: { id: true } });
      if (!flag) throw new NotFoundException('Feature flag not found.');

      // One rule per flag per target, matching the partial unique indexes on the table. Finding the
      // existing one first turns a repeat call into an edit rather than a constraint violation.
      const existing = await tx.featureFlagRule.findFirst({
        where: {
          flagId,
          scope: input.scope,
          countryCode: input.countryCode ?? null,
          planId: input.planId ?? null,
          organizationId: input.organizationId ?? null,
        },
        select: { id: true, enabled: true },
      });

      const rule = existing
        ? await tx.featureFlagRule.update({
            where: { id: existing.id },
            data: { enabled: input.enabled, note: input.note ?? null },
          })
        : await tx.featureFlagRule.create({
            data: {
              flagId,
              scope: input.scope,
              countryCode: input.countryCode ?? null,
              planId: input.planId ?? null,
              organizationId: input.organizationId ?? null,
              enabled: input.enabled,
              note: input.note ?? null,
            },
          });

      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_rule_set',
        targetType: 'feature_flag_rule',
        targetId: rule.id,
        organizationId: input.organizationId ?? null,
        before: existing ? { enabled: existing.enabled } : undefined,
        after: { scope: rule.scope, enabled: rule.enabled },
        ipHash,
      });
      return { id: rule.id, scope: rule.scope, enabled: rule.enabled };
    });
  }

  async removeFlagRule(actor: PlatformContext, ruleId: string, ipHash: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.featureFlagRule.findUnique({ where: { id: ruleId } });
      if (!existing) throw new NotFoundException('Feature flag rule not found.');
      await tx.featureFlagRule.delete({ where: { id: ruleId } });
      await writePlatformAudit(tx, actor, {
        eventKey: 'platform.feature_flag_rule_removed',
        targetType: 'feature_flag_rule',
        targetId: ruleId,
        organizationId: existing.organizationId,
        before: { scope: existing.scope, enabled: existing.enabled },
        ipHash,
      });
    });
  }
}

/**
 * The scope and its target must agree. The table carries the same check, but a constraint violation
 * surfaces as a 500; this makes it a 400 that names the mistake.
 */
function assertScopeTarget(input: UpsertFlagRuleDto): void {
  const targets = {
    COUNTRY: input.countryCode,
    PLAN: input.planId,
    ORGANIZATION: input.organizationId,
  };
  for (const [scope, value] of Object.entries(targets)) {
    if (scope === input.scope && !value) {
      throw new BadRequestException(`A ${scope} rule must name a ${scope.toLowerCase()}.`);
    }
    if (scope !== input.scope && value) {
      throw new BadRequestException(
        `A ${input.scope} rule must not name a ${scope.toLowerCase()}.`,
      );
    }
  }
}
