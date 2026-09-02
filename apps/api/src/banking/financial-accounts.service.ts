import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type {
  CreateFinancialAccountDto,
  UpdateFinancialAccountDto,
} from './financial-accounts.dto.js';

@Injectable()
export class FinancialAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, active?: string) {
    const accounts = await this.prisma.financialAccount.findMany({
      where: { organizationId, ...(active !== undefined ? { active: active === 'true' } : {}) },
      orderBy: [{ name: 'asc' }],
    });
    return accounts.map(summarize);
  }

  async detail(organizationId: string, financialAccountId: string) {
    const account = await this.findOrThrow(organizationId, financialAccountId);
    return summarize(account);
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateFinancialAccountDto,
    metadata: RequestMetadata,
  ) {
    await this.assertGlAccount(context.id, input.glAccountId);
    const existing = await this.prisma.financialAccount.findUnique({
      where: { organizationId_name: { organizationId: context.id, name: input.name } },
    });
    if (existing) throw new ConflictException('A financial account with this name already exists.');

    const created = await this.prisma.$transaction(async (tx) => {
      const account = await tx.financialAccount.create({
        data: {
          organizationId: context.id,
          name: input.name,
          type: input.type,
          currency: input.currency,
          glAccountId: input.glAccountId,
          openingBalanceMinor: input.openingBalanceMinor ? BigInt(input.openingBalanceMinor) : 0n,
          createdByUserId: user.id,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.financial_account_created',
        entityType: 'financial_account',
        entityId: account.id,
        action: AuditAction.CREATE,
        after: { name: account.name, currency: account.currency },
        ipHash: metadata.ipHash,
      });
      return account;
    });

    return summarize(created);
  }

  async update(
    context: OrganizationContext,
    user: PublicUser,
    financialAccountId: string,
    input: UpdateFinancialAccountDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findOrThrow(context.id, financialAccountId);

    if (input.currency && input.currency !== existing.currency) {
      const hasActivity = await this.prisma.bankTransaction.findFirst({
        where: { financialAccountId },
        select: { id: true },
      });
      if (hasActivity || existing.lastActivityAt) {
        throw new ConflictException(
          'This account has recorded activity; its currency can no longer be changed.',
        );
      }
    }

    if (input.name && input.name !== existing.name) {
      const clash = await this.prisma.financialAccount.findUnique({
        where: { organizationId_name: { organizationId: context.id, name: input.name } },
      });
      if (clash) throw new ConflictException('A financial account with this name already exists.');
    }

    if (input.glAccountId && input.glAccountId !== existing.glAccountId) {
      await this.assertGlAccount(context.id, input.glAccountId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const account = await tx.financialAccount.update({
        where: { id: financialAccountId },
        data: {
          name: input.name ?? existing.name,
          type: input.type ?? existing.type,
          currency: input.currency ?? existing.currency,
          glAccountId: input.glAccountId ?? existing.glAccountId,
          active: input.active ?? existing.active,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.financial_account_updated',
        entityType: 'financial_account',
        entityId: financialAccountId,
        action: AuditAction.UPDATE,
        before: { name: existing.name, active: existing.active },
        after: { name: account.name, active: account.active },
        ipHash: metadata.ipHash,
      });
      return account;
    });

    return summarize(updated);
  }

  private async findOrThrow(organizationId: string, financialAccountId: string) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id: financialAccountId, organizationId },
    });
    if (!account) throw new NotFoundException('Financial account not found.');
    return account;
  }

  private async assertGlAccount(organizationId: string, glAccountId: string): Promise<void> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { id: glAccountId, organizationId },
    });
    if (!account) throw new NotFoundException('GL account not found.');
    if (account.status !== 'ACTIVE') {
      throw new ConflictException('The GL account mapped to a financial account must be active.');
    }
  }
}

function summarize(account: {
  id: string;
  name: string;
  type: string;
  currency: string;
  glAccountId: string;
  openingBalanceMinor: bigint;
  active: boolean;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    glAccountId: account.glAccountId,
    openingBalanceMinor: account.openingBalanceMinor.toString(),
    active: account.active,
    lastActivityAt: account.lastActivityAt?.toISOString() ?? null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
