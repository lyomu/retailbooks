import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type { CreateBankRuleDto, UpdateBankRuleDto } from './bank-rules.dto.js';

@Injectable()
export class BankRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const rules = await this.prisma.bankRule.findMany({
      where: { organizationId },
      orderBy: [{ priority: 'asc' }],
    });
    return rules.map(summarize);
  }

  async detail(organizationId: string, bankRuleId: string) {
    const rule = await this.findOrThrow(organizationId, bankRuleId);
    return summarize(rule);
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateBankRuleDto,
    metadata: RequestMetadata,
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      const rule = await tx.bankRule.create({
        data: {
          organizationId: context.id,
          name: input.name,
          priority: input.priority,
          matchAny: input.matchAny ?? false,
          conditions: input.conditions as unknown as Prisma.InputJsonValue,
          suggestAccountId: input.suggestAccountId ?? null,
          suggestContactId: input.suggestContactId ?? null,
          suggestVendorId: input.suggestVendorId ?? null,
          suggestTags: input.suggestTags ?? [],
          stopOnMatch: input.stopOnMatch ?? false,
          createdByUserId: user.id,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.bank_rule_created',
        entityType: 'bank_rule',
        entityId: rule.id,
        action: AuditAction.CREATE,
        after: { name: rule.name, priority: rule.priority },
        ipHash: metadata.ipHash,
      });
      return rule;
    });

    return summarize(created);
  }

  async update(
    context: OrganizationContext,
    user: PublicUser,
    bankRuleId: string,
    input: UpdateBankRuleDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, bankRuleId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const rule = await tx.bankRule.update({
        where: { id: bankRuleId },
        data: {
          name: input.name ?? existing.name,
          priority: input.priority ?? existing.priority,
          matchAny: input.matchAny ?? existing.matchAny,
          conditions: input.conditions
            ? (input.conditions as unknown as Prisma.InputJsonValue)
            : (existing.conditions as Prisma.InputJsonValue),
          suggestAccountId:
            input.suggestAccountId !== undefined
              ? input.suggestAccountId
              : existing.suggestAccountId,
          suggestContactId:
            input.suggestContactId !== undefined
              ? input.suggestContactId
              : existing.suggestContactId,
          suggestVendorId:
            input.suggestVendorId !== undefined ? input.suggestVendorId : existing.suggestVendorId,
          suggestTags: input.suggestTags ?? existing.suggestTags,
          stopOnMatch: input.stopOnMatch ?? existing.stopOnMatch,
          active: input.active ?? existing.active,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.bank_rule_updated',
        entityType: 'bank_rule',
        entityId: bankRuleId,
        action: AuditAction.UPDATE,
        before: { active: existing.active },
        after: { active: rule.active },
        ipHash: metadata.ipHash,
      });
      return rule;
    });

    return summarize(updated);
  }

  private async findOrThrow(organizationId: string, bankRuleId: string) {
    const rule = await this.prisma.bankRule.findFirst({
      where: { id: bankRuleId, organizationId },
    });
    if (!rule) throw new NotFoundException('Bank rule not found.');
    return rule;
  }
}

function summarize(rule: {
  id: string;
  name: string;
  priority: number;
  active: boolean;
  matchAny: boolean;
  conditions: unknown;
  suggestAccountId: string | null;
  suggestContactId: string | null;
  suggestVendorId: string | null;
  suggestTags: string[];
  stopOnMatch: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: rule.id,
    name: rule.name,
    priority: rule.priority,
    active: rule.active,
    matchAny: rule.matchAny,
    conditions: rule.conditions,
    suggestAccountId: rule.suggestAccountId,
    suggestContactId: rule.suggestContactId,
    suggestVendorId: rule.suggestVendorId,
    suggestTags: rule.suggestTags,
    stopOnMatch: rule.stopOnMatch,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}
