import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import type {
  CreateCategoryDto,
  CreateItemDto,
  CreateUnitDto,
  ItemPriceDto,
  UpdateCategoryDto,
  UpdateItemDto,
  UpdateUnitDto,
} from './catalog.dto.js';

type ItemWithPrices = Prisma.ItemGetPayload<{ include: { prices: true } }>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Units ---

  async listUnits(organizationId: string) {
    return this.prisma.unit.findMany({ where: { organizationId }, orderBy: [{ code: 'asc' }] });
  }

  async createUnit(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateUnitDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.unit.findUnique({
      where: { organizationId_code: { organizationId: context.id, code: input.code } },
    });
    if (existing) throw new ConflictException('A unit with this code already exists.');

    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.unit.create({ data: { organizationId: context.id, ...input } });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'catalog.unit_created',
        entityType: 'unit',
        entityId: unit.id,
        action: AuditAction.CREATE,
        after: { code: unit.code, name: unit.name },
        ipHash: metadata.ipHash,
      });
      return unit;
    });
  }

  async updateUnit(
    context: OrganizationContext,
    user: PublicUser,
    unitId: string,
    input: UpdateUnitDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.unit.findFirst({
      where: { id: unitId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Unit not found.');
    if (input.code && input.code !== existing.code) {
      const clash = await this.prisma.unit.findUnique({
        where: { organizationId_code: { organizationId: context.id, code: input.code } },
      });
      if (clash) throw new ConflictException('A unit with this code already exists.');
    }

    return this.prisma.$transaction(async (tx) => {
      const unit = await tx.unit.update({ where: { id: unitId }, data: input });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'catalog.unit_updated',
        entityType: 'unit',
        entityId: unitId,
        action: AuditAction.UPDATE,
        before: { code: existing.code, name: existing.name },
        after: { code: unit.code, name: unit.name },
        ipHash: metadata.ipHash,
      });
      return unit;
    });
  }

  // --- Categories ---

  async listCategories(organizationId: string) {
    return this.prisma.category.findMany({
      where: { organizationId },
      orderBy: [{ name: 'asc' }],
    });
  }

  async createCategory(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateCategoryDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.category.findUnique({
      where: { organizationId_name: { organizationId: context.id, name: input.name } },
    });
    if (existing) throw new ConflictException('A category with this name already exists.');

    return this.prisma.$transaction(async (tx) => {
      const category = await tx.category.create({
        data: {
          organizationId: context.id,
          name: input.name,
          parentCategoryId: input.parentCategoryId ?? null,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'catalog.category_created',
        entityType: 'category',
        entityId: category.id,
        action: AuditAction.CREATE,
        after: { name: category.name },
        ipHash: metadata.ipHash,
      });
      return category;
    });
  }

  async updateCategory(
    context: OrganizationContext,
    user: PublicUser,
    categoryId: string,
    input: UpdateCategoryDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Category not found.');
    if (input.name && input.name !== existing.name) {
      const clash = await this.prisma.category.findUnique({
        where: { organizationId_name: { organizationId: context.id, name: input.name } },
      });
      if (clash) throw new ConflictException('A category with this name already exists.');
    }
    if (input.parentCategoryId === categoryId) {
      throw new ConflictException('A category cannot be its own parent.');
    }

    return this.prisma.$transaction(async (tx) => {
      const category = await tx.category.update({
        where: { id: categoryId },
        data: {
          name: input.name ?? existing.name,
          parentCategoryId:
            input.parentCategoryId !== undefined
              ? input.parentCategoryId
              : existing.parentCategoryId,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'catalog.category_updated',
        entityType: 'category',
        entityId: categoryId,
        action: AuditAction.UPDATE,
        before: { name: existing.name },
        after: { name: category.name },
        ipHash: metadata.ipHash,
      });
      return category;
    });
  }

  // --- Items ---

  async listItems(organizationId: string, status?: 'ACTIVE' | 'INACTIVE') {
    const items = await this.prisma.item.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: [{ name: 'asc' }],
      include: { prices: true },
    });
    return items.map(summarizeItem);
  }

  async itemDetail(organizationId: string, itemId: string) {
    const item = await this.findItemOrThrow(organizationId, itemId);
    return summarizeItem(item);
  }

  async createItem(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateItemDto,
    metadata: RequestMetadata,
  ) {
    if (input.sku) await this.assertSkuAvailable(context.id, input.sku);

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.id },
      select: { preferences: { select: { salesFreeDescriptionDefault: true } } },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          organizationId: context.id,
          sku: input.sku ?? null,
          name: input.name,
          itemType: input.itemType,
          categoryId: input.categoryId ?? null,
          defaultUnitId: input.defaultUnitId ?? null,
          revenueAccountId: input.revenueAccountId ?? null,
          defaultTaxCodeId: input.defaultTaxCodeId ?? null,
          freeDescriptionAllowed:
            input.freeDescriptionAllowed ??
            organization.preferences?.salesFreeDescriptionDefault ??
            true,
          prices: { create: (input.prices ?? []).map((p) => priceData(p, context.id)) },
        },
        include: { prices: true },
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'catalog.item_created',
        entityType: 'item',
        entityId: item.id,
        action: AuditAction.CREATE,
        after: { name: item.name, itemType: item.itemType },
        ipHash: metadata.ipHash,
      });

      return item;
    });

    return summarizeItem(created);
  }

  async updateItem(
    context: OrganizationContext,
    user: PublicUser,
    itemId: string,
    input: UpdateItemDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.findItemOrThrow(context.id, itemId);
    if (input.sku && input.sku !== existing.sku) {
      await this.assertSkuAvailable(context.id, input.sku, itemId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.prices) {
        await tx.itemPrice.deleteMany({ where: { itemId } });
      }

      const item = await tx.item.update({
        where: { id: itemId },
        data: {
          sku: input.sku ?? existing.sku,
          name: input.name ?? existing.name,
          itemType: input.itemType ?? existing.itemType,
          categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
          defaultUnitId:
            input.defaultUnitId !== undefined ? input.defaultUnitId : existing.defaultUnitId,
          revenueAccountId:
            input.revenueAccountId !== undefined
              ? input.revenueAccountId
              : existing.revenueAccountId,
          defaultTaxCodeId:
            input.defaultTaxCodeId !== undefined
              ? input.defaultTaxCodeId
              : existing.defaultTaxCodeId,
          freeDescriptionAllowed: input.freeDescriptionAllowed ?? existing.freeDescriptionAllowed,
          ...(input.prices
            ? { prices: { create: input.prices.map((p) => priceData(p, context.id)) } }
            : {}),
        },
        include: { prices: true },
      });

      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'catalog.item_updated',
        entityType: 'item',
        entityId: itemId,
        action: AuditAction.UPDATE,
        before: { name: existing.name, itemType: existing.itemType },
        after: { name: item.name, itemType: item.itemType },
        ipHash: metadata.ipHash,
      });

      return item;
    });

    return summarizeItem(updated);
  }

  async setItemStatus(
    context: OrganizationContext,
    user: PublicUser,
    itemId: string,
    status: 'ACTIVE' | 'INACTIVE',
    metadata: RequestMetadata,
  ) {
    const existing = await this.findItemOrThrow(context.id, itemId);
    if (existing.status === status) return summarizeItem(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const item = await tx.item.update({
        where: { id: itemId },
        data: { status },
        include: { prices: true },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: status === 'ACTIVE' ? 'catalog.item_reactivated' : 'catalog.item_deactivated',
        entityType: 'item',
        entityId: itemId,
        action: AuditAction.UPDATE,
        before: { status: existing.status },
        after: { status },
        ipHash: metadata.ipHash,
      });
      return item;
    });

    return summarizeItem(updated);
  }

  private async findItemOrThrow(organizationId: string, itemId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, organizationId },
      include: { prices: true },
    });
    if (!item) throw new NotFoundException('Item not found.');
    return item;
  }

  private async assertSkuAvailable(
    organizationId: string,
    sku: string,
    excludeItemId?: string,
  ): Promise<void> {
    const clash = await this.prisma.item.findFirst({
      where: { organizationId, sku, ...(excludeItemId ? { id: { not: excludeItemId } } : {}) },
    });
    if (clash) throw new ConflictException('An item with this SKU already exists.');
  }
}

function priceData(input: ItemPriceDto, organizationId: string) {
  return {
    organizationId,
    priceListKey: input.priceListKey ?? 'default',
    currency: input.currency,
    unitPriceMinor: BigInt(input.unitPriceMinor),
  };
}

function summarizeItem(item: ItemWithPrices) {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    itemType: item.itemType,
    categoryId: item.categoryId,
    defaultUnitId: item.defaultUnitId,
    revenueAccountId: item.revenueAccountId,
    defaultTaxCodeId: item.defaultTaxCodeId,
    freeDescriptionAllowed: item.freeDescriptionAllowed,
    status: item.status,
    prices: item.prices.map((price) => ({
      id: price.id,
      priceListKey: price.priceListKey,
      currency: price.currency,
      unitPriceMinor: price.unitPriceMinor.toString(),
    })),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
