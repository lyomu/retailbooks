import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './expense-categories.dto.js';

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.expenseCategory.findMany({
      where: { organizationId },
      orderBy: [{ name: 'asc' }],
    });
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateExpenseCategoryDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.expenseCategory.findUnique({
      where: { organizationId_name: { organizationId: context.id, name: input.name } },
    });
    if (existing) throw new ConflictException('An expense category with this name already exists.');

    return this.prisma.$transaction(async (tx) => {
      const category = await tx.expenseCategory.create({
        data: { organizationId: context.id, name: input.name, accountId: input.accountId },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.expense_category_created',
        entityType: 'expense_category',
        entityId: category.id,
        action: AuditAction.CREATE,
        after: { name: category.name },
        ipHash: metadata.ipHash,
      });
      return category;
    });
  }

  async update(
    context: OrganizationContext,
    user: PublicUser,
    categoryId: string,
    input: UpdateExpenseCategoryDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Expense category not found.');
    if (input.name && input.name !== existing.name) {
      const clash = await this.prisma.expenseCategory.findUnique({
        where: { organizationId_name: { organizationId: context.id, name: input.name } },
      });
      if (clash) throw new ConflictException('An expense category with this name already exists.');
    }

    return this.prisma.$transaction(async (tx) => {
      const category = await tx.expenseCategory.update({
        where: { id: categoryId },
        data: {
          name: input.name ?? existing.name,
          accountId: input.accountId ?? existing.accountId,
          active: input.active ?? existing.active,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'purchases.expense_category_updated',
        entityType: 'expense_category',
        entityId: categoryId,
        action: AuditAction.UPDATE,
        before: { name: existing.name, active: existing.active },
        after: { name: category.name, active: category.active },
        ipHash: metadata.ipHash,
      });
      return category;
    });
  }
}
