import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  convertForeignMinorToBaseMinor,
  parseExchangeRateToScaled,
} from '@retailbooks/accounting-core';
import { AuditAction, CurrencyStatus, JournalStatus, Prisma, type Currency } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from './audit-event.js';
import { currencies, findCurrency } from './jurisdiction-catalog.js';
import type { OrganizationContext } from './organization-context.js';
import type {
  EnableOrganizationCurrencyDto,
  UpdateOrganizationCurrencyDto,
  UpsertExchangeRateDto,
} from './currency.dto.js';

type CurrencyClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class CurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureCatalog(client: CurrencyClient = this.prisma): Promise<void> {
    await client.currency.createMany({
      data: currencies.map((currency) => ({
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        decimals: currency.minorUnits,
        status: CurrencyStatus.ACTIVE,
      })),
      skipDuplicates: true,
    });
  }

  async ensureOrganizationBaseCurrency(
    client: CurrencyClient,
    organizationId: string,
    currencyCode: string,
  ): Promise<void> {
    await this.ensureCatalog(client);
    await client.organizationCurrency.updateMany({
      where: { organizationId, isBase: true, currencyCode: { not: currencyCode } },
      data: { isBase: false },
    });
    await client.organizationCurrency.upsert({
      where: { organizationId_currencyCode: { organizationId, currencyCode } },
      create: { organizationId, currencyCode, isBase: true, enabled: true },
      update: { isBase: true, enabled: true },
    });
  }

  async catalog() {
    await this.ensureCatalog();
    const rows = await this.prisma.currency.findMany({
      where: { status: CurrencyStatus.ACTIVE },
      orderBy: { code: 'asc' },
    });
    return rows.map(currencyResult);
  }

  async list(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    if (!organization) throw new NotFoundException('Organization not found.');

    await this.prisma.$transaction((tx) =>
      this.ensureOrganizationBaseCurrency(tx, organizationId, organization.baseCurrency),
    );

    const [enabledCurrencies, exchangeRates] = await Promise.all([
      this.prisma.organizationCurrency.findMany({
        where: { organizationId },
        include: { currency: true },
        orderBy: [{ isBase: 'desc' }, { currencyCode: 'asc' }],
      }),
      this.prisma.exchangeRate.findMany({
        where: { organizationId },
        include: { quote: true },
        orderBy: [{ rateDate: 'desc' }, { quoteCurrency: 'asc' }],
        take: 100,
      }),
    ]);

    return {
      baseCurrency: organization.baseCurrency,
      currencies: enabledCurrencies.map((entry) => ({
        ...currencyResult(entry.currency),
        isBase: entry.isBase,
        enabled: entry.enabled,
      })),
      exchangeRates: exchangeRates.map((rate) => ({
        id: rate.id,
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        quoteCurrencyName: rate.quote.name,
        rate: rate.rate.toString(),
        rateDate: dateOnly(rate.rateDate),
        source: rate.source,
        createdAt: rate.createdAt.toISOString(),
      })),
    };
  }

  async enable(
    context: OrganizationContext,
    user: PublicUser,
    input: EnableOrganizationCurrencyDto,
    metadata: RequestMetadata,
  ) {
    const definition = findCurrency(input.currencyCode);
    if (!definition) throw new BadRequestException('That currency is not available yet.');

    await this.prisma.$transaction(async (tx) => {
      await this.ensureCatalog(tx);
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      await tx.organizationCurrency.upsert({
        where: {
          organizationId_currencyCode: {
            organizationId: context.id,
            currencyCode: definition.code,
          },
        },
        create: {
          organizationId: context.id,
          currencyCode: definition.code,
          enabled: true,
          isBase: definition.code === organization.baseCurrency,
        },
        update: { enabled: true },
      });
      await currencyEvents(tx, context.id, user.id, 'currency.enabled', metadata, {
        currencyCode: definition.code,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'currency.enabled',
        entityType: 'organization_currency',
        entityId: definition.code,
        action: AuditAction.UPDATE,
        before: { enabled: false },
        after: { enabled: true },
        ipHash: metadata.ipHash,
      });
    });

    return this.list(context.id);
  }

  async updateEnabled(
    context: OrganizationContext,
    user: PublicUser,
    currencyCode: string,
    input: UpdateOrganizationCurrencyDto,
    metadata: RequestMetadata,
  ) {
    const code = currencyCode.toUpperCase();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.organizationCurrency.findUnique({
        where: { organizationId_currencyCode: { organizationId: context.id, currencyCode: code } },
      });
      if (!existing) throw new NotFoundException('Organization currency not found.');
      if (existing.isBase && !input.enabled) {
        throw new ConflictException('The base currency cannot be disabled.');
      }
      if (existing.enabled === input.enabled) return;

      await tx.organizationCurrency.update({
        where: { organizationId_currencyCode: { organizationId: context.id, currencyCode: code } },
        data: { enabled: input.enabled },
      });
      const eventKey = input.enabled ? 'currency.enabled' : 'currency.disabled';
      await currencyEvents(tx, context.id, user.id, eventKey, metadata, { currencyCode: code });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey,
        entityType: 'organization_currency',
        entityId: code,
        action: AuditAction.UPDATE,
        before: { enabled: existing.enabled },
        after: { enabled: input.enabled },
        ipHash: metadata.ipHash,
      });
    });

    return this.list(context.id);
  }

  async upsertRate(
    context: OrganizationContext,
    user: PublicUser,
    input: UpsertExchangeRateDto,
    metadata: RequestMetadata,
  ) {
    parseExchangeRateToScaled(input.rate);
    const rateDate = new Date(`${input.rateDate}T00:00:00.000Z`);

    await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      if (input.quoteCurrency === organization.baseCurrency) {
        throw new BadRequestException('The base currency always has an exchange rate of 1.');
      }
      const enabled = await tx.organizationCurrency.findUnique({
        where: {
          organizationId_currencyCode: {
            organizationId: context.id,
            currencyCode: input.quoteCurrency,
          },
        },
      });
      if (!enabled?.enabled) {
        throw new BadRequestException('Enable the quote currency before adding a rate.');
      }

      const key = {
        organizationId: context.id,
        baseCurrency: organization.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        rateDate,
      };
      const existing = await tx.exchangeRate.findUnique({
        where: { organizationId_baseCurrency_quoteCurrency_rateDate: key },
      });
      const rate = await tx.exchangeRate.upsert({
        where: { organizationId_baseCurrency_quoteCurrency_rateDate: key },
        create: { ...key, rate: input.rate, source: input.source || 'MANUAL' },
        update: { rate: input.rate, source: input.source || 'MANUAL' },
      });
      const eventKey = existing
        ? 'currency.exchange_rate_updated'
        : 'currency.exchange_rate_created';
      await currencyEvents(tx, context.id, user.id, eventKey, metadata, {
        exchangeRateId: rate.id,
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rate: rate.rate.toString(),
        rateDate: input.rateDate,
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey,
        entityType: 'exchange_rate',
        entityId: rate.id,
        action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
        before: existing ? { rate: existing.rate.toString(), source: existing.source } : undefined,
        after: { rate: rate.rate.toString(), source: rate.source, rateDate: input.rateDate },
        ipHash: metadata.ipHash,
      });
    });

    return this.list(context.id);
  }

  async setBaseCurrency(
    tx: Prisma.TransactionClient,
    organizationId: string,
    currencyCode: string,
    user: PublicUser,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.ensureCatalog(tx);
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    if (organization.baseCurrency === currencyCode) {
      await this.ensureOrganizationBaseCurrency(tx, organizationId, currencyCode);
      return;
    }

    const postedActivity = await tx.journal.count({
      where: {
        organizationId,
        status: { in: [JournalStatus.POSTED, JournalStatus.REVERSED] },
      },
    });
    if (postedActivity > 0) {
      throw new ConflictException(
        'Base currency cannot change after accounting activity is posted.',
      );
    }

    await tx.organization.update({
      where: { id: organizationId },
      data: { baseCurrency: currencyCode },
    });
    await this.ensureOrganizationBaseCurrency(tx, organizationId, currencyCode);
    await currencyEvents(tx, organizationId, user.id, 'currency.base_changed', metadata, {
      before: organization.baseCurrency,
      after: currencyCode,
    });
    await writeAuditEvent(tx, {
      organizationId,
      actorUserId: user.id,
      eventKey: 'currency.base_changed',
      entityType: 'organization',
      entityId: organizationId,
      action: AuditAction.UPDATE,
      before: { baseCurrency: organization.baseCurrency },
      after: { baseCurrency: currencyCode },
      ipHash: metadata.ipHash,
    });
  }

  async resolveRate(
    tx: Prisma.TransactionClient,
    organizationId: string,
    baseCurrency: string,
    quoteCurrency: string,
    rateDate: Date,
    explicitRate?: string | null,
  ): Promise<{ rate: string; base: Currency; quote: Currency }> {
    await this.ensureCatalog(tx);
    const enabled = await tx.organizationCurrency.findUnique({
      where: { organizationId_currencyCode: { organizationId, currencyCode: quoteCurrency } },
      include: { currency: true },
    });
    if (!enabled?.enabled)
      throw new BadRequestException('Enable the journal currency before posting.');
    const base = await tx.currency.findUniqueOrThrow({ where: { code: baseCurrency } });

    if (explicitRate) {
      parseExchangeRateToScaled(explicitRate);
      return { rate: new Prisma.Decimal(explicitRate).toString(), base, quote: enabled.currency };
    }

    const stored = await tx.exchangeRate.findFirst({
      where: {
        organizationId,
        baseCurrency,
        quoteCurrency,
        rateDate: { lte: rateDate },
      },
      orderBy: { rateDate: 'desc' },
    });
    if (!stored)
      throw new BadRequestException('Add an exchange rate on or before the journal date.');
    return { rate: stored.rate.toString(), base, quote: enabled.currency };
  }

  convert(
    input: Readonly<{
      foreignAmountMinor: bigint;
      exchangeRate: string;
      base: Pick<Currency, 'decimals'>;
      quote: Pick<Currency, 'decimals'>;
    }>,
  ): bigint {
    return convertForeignMinorToBaseMinor({
      foreignAmountMinor: input.foreignAmountMinor,
      exchangeRate: input.exchangeRate,
      baseMinorUnits: input.base.decimals,
      quoteMinorUnits: input.quote.decimals,
    });
  }
}

function currencyResult(currency: Currency) {
  return {
    code: currency.code,
    name: currency.name,
    symbol: currency.symbol,
    minorUnits: currency.decimals,
    status: currency.status,
  };
}

function currencyEvents(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  eventKey: string,
  metadata: RequestMetadata,
  details: Prisma.InputJsonObject,
) {
  return tx.securityEvent.create({
    data: { organizationId, userId, eventKey, ipHash: metadata.ipHash, metadata: details },
  });
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
