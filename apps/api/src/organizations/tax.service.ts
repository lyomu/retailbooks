import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JournalStatus,
  TaxCodeStatus,
  type Prisma,
  type TaxCode,
  type TaxRate,
} from '@prisma/client';
import {
  parseRatePercentToScaled,
  splitInclusiveAmount,
  taxAmountExclusive,
} from '@retailbooks/accounting-core';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { starterTaxCodesForCountryPack } from './tax-code-catalog.js';
import {
  CalculateTaxDto,
  CreateTaxCodeDto,
  CreateTaxRateDto,
  UpdateTaxCodeDto,
} from './tax.dto.js';
import { rangesOverlap, resolveEffectiveRate } from './tax-rate-resolution.js';
import type { OrganizationContext } from './organization-context.js';

/**
 * Resolves the rate effective on a date from Prisma-shaped rows, where `effectiveFrom`/`effectiveTo`
 * are `Date` objects rather than the date-only strings `resolveEffectiveRate` compares against.
 */
function effectiveRateAsOf<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(
  rates: readonly T[],
  asOfDate: string,
): T | undefined {
  const withStringDates = rates.map((rate) => ({
    original: rate,
    effectiveFrom: dateOnly(rate.effectiveFrom),
    effectiveTo: rate.effectiveTo ? dateOnly(rate.effectiveTo) : null,
  }));
  return resolveEffectiveRate(withStringDates, asOfDate)?.original;
}

const POSTED_STATUSES = [JournalStatus.POSTED, JournalStatus.REVERSED] as const;

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureStarterTaxCodes(organizationId: string): Promise<void> {
    const count = await this.prisma.taxCode.count({ where: { organizationId } });
    if (count > 0) return;

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { preferences: { select: { countryPackCode: true } } },
    });
    if (!organization?.preferences) throw new NotFoundException('Organization not found.');

    const starterCodes = starterTaxCodesForCountryPack(organization.preferences.countryPackCode);
    const accountCodes = Array.from(
      new Set(
        starterCodes.flatMap((code) =>
          [code.salesTaxAccountCode, code.purchaseTaxAccountCode].filter((value): value is string =>
            Boolean(value),
          ),
        ),
      ),
    );
    const accounts = accountCodes.length
      ? await this.prisma.ledgerAccount.findMany({
          where: { organizationId, code: { in: accountCodes } },
          select: { id: true, code: true },
        })
      : [];
    const accountIdByCode = new Map(accounts.map((account) => [account.code, account.id]));

    await this.prisma.taxCode.createMany({
      data: starterCodes.map((code) => ({
        organizationId,
        code: code.code,
        name: code.name,
        treatment: code.treatment,
        recoverable: code.recoverable,
        description: code.description,
        salesTaxAccountId: code.salesTaxAccountCode
          ? accountIdByCode.get(code.salesTaxAccountCode)
          : undefined,
        purchaseTaxAccountId: code.purchaseTaxAccountCode
          ? accountIdByCode.get(code.purchaseTaxAccountCode)
          : undefined,
        systemSeed: true,
      })),
      skipDuplicates: true,
    });
  }

  async listTaxCodes(organizationId: string) {
    await this.ensureStarterTaxCodes(organizationId);
    const codes = await this.prisma.taxCode.findMany({
      where: { organizationId },
      orderBy: [{ code: 'asc' }],
      include: { rates: { orderBy: { effectiveFrom: 'desc' } } },
    });
    const today = dateOnly(new Date());
    return codes.map((code) => taxCodeSummary(code, effectiveRateAsOf(code.rates, today)));
  }

  async createTaxCode(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateTaxCodeDto,
    metadata: RequestMetadata,
  ) {
    await this.assertAccountsBelongToOrganization(context.id, [
      input.salesTaxAccountId,
      input.purchaseTaxAccountId,
    ]);

    const created = await this.prisma.$transaction(async (tx) => {
      const code = await tx.taxCode.create({
        data: { organizationId: context.id, ...input, systemSeed: false },
      });
      await taxEvent(tx, user.id, context.id, 'tax.code_created', metadata, {
        taxCodeId: code.id,
        code: code.code,
      });
      return code;
    });

    return taxCodeSummary({ ...created, rates: [] }, undefined);
  }

  async updateTaxCode(
    context: OrganizationContext,
    user: PublicUser,
    taxCodeId: string,
    input: UpdateTaxCodeDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.taxCode.findFirst({
      where: { id: taxCodeId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Tax code not found.');
    if (existing.status === TaxCodeStatus.ARCHIVED) {
      throw new ConflictException('Archived tax codes cannot be edited.');
    }
    if (
      ((input.treatment && input.treatment !== existing.treatment) ||
        (input.recoverable !== undefined && input.recoverable !== existing.recoverable)) &&
      (await this.hasPostedLineHistory(context.id, taxCodeId))
    ) {
      throw new ConflictException(
        'Tax codes with posted history cannot change treatment or recoverability.',
      );
    }
    await this.assertAccountsBelongToOrganization(context.id, [
      input.salesTaxAccountId,
      input.purchaseTaxAccountId,
    ]);

    const updated = await this.prisma.$transaction(async (tx) => {
      const code = await tx.taxCode.update({ where: { id: taxCodeId }, data: input });
      await taxEvent(tx, user.id, context.id, 'tax.code_updated', metadata, {
        taxCodeId,
        before: { treatment: existing.treatment, recoverable: existing.recoverable },
        after: {
          treatment: input.treatment ?? null,
          recoverable: input.recoverable ?? null,
        },
      });
      return code;
    });

    const rates = await this.prisma.taxRate.findMany({
      where: { taxCodeId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return taxCodeSummary({ ...updated, rates }, effectiveRateAsOf(rates, dateOnly(new Date())));
  }

  async archiveTaxCode(
    context: OrganizationContext,
    user: PublicUser,
    taxCodeId: string,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.taxCode.findFirst({
      where: { id: taxCodeId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Tax code not found.');
    if (existing.status === TaxCodeStatus.ARCHIVED) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.taxCode.update({
        where: { id: taxCodeId },
        data: { status: TaxCodeStatus.ARCHIVED, archivedAt: new Date() },
      });
      await taxEvent(tx, user.id, context.id, 'tax.code_archived', metadata, {
        taxCodeId,
        code: existing.code,
      });
    });
  }

  async listRates(organizationId: string, taxCodeId: string) {
    const code = await this.prisma.taxCode.findFirst({
      where: { id: taxCodeId, organizationId },
    });
    if (!code) throw new NotFoundException('Tax code not found.');
    const rates = await this.prisma.taxRate.findMany({
      where: { taxCodeId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rates.map(taxRateSummary);
  }

  async createRate(
    context: OrganizationContext,
    user: PublicUser,
    taxCodeId: string,
    input: CreateTaxRateDto,
    metadata: RequestMetadata,
  ) {
    const code = await this.prisma.taxCode.findFirst({
      where: { id: taxCodeId, organizationId: context.id },
    });
    if (!code) throw new NotFoundException('Tax code not found.');
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new BadRequestException('effectiveTo cannot be before effectiveFrom.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const existingRates = await tx.taxRate.findMany({
        where: { taxCodeId },
        select: { effectiveFrom: true, effectiveTo: true },
      });
      const candidate = {
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      };
      const overlaps = existingRates.some((rate) =>
        rangesOverlap(candidate, {
          effectiveFrom: dateOnly(rate.effectiveFrom),
          effectiveTo: rate.effectiveTo ? dateOnly(rate.effectiveTo) : null,
        }),
      );
      if (overlaps) {
        throw new ConflictException('This effective date range overlaps an existing rate.');
      }

      const rate = await tx.taxRate.create({
        data: {
          organizationId: context.id,
          taxCodeId,
          ratePercent: input.ratePercent,
          effectiveFrom: isoDate(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? isoDate(input.effectiveTo) : undefined,
        },
      });
      await taxEvent(tx, user.id, context.id, 'tax.rate_added', metadata, {
        taxCodeId,
        rateId: rate.id,
        ratePercent: input.ratePercent,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      });
      return rate;
    });

    return taxRateSummary(created);
  }

  async calculate(organizationId: string, input: CalculateTaxDto) {
    const code = await this.prisma.taxCode.findFirst({
      where: { id: input.taxCodeId, organizationId },
      include: { rates: true },
    });
    if (!code) throw new NotFoundException('Tax code not found.');

    const asOfDate = input.asOfDate ?? dateOnly(new Date());
    const rate = effectiveRateAsOf(code.rates, asOfDate);
    if (!rate) {
      throw new BadRequestException(`Tax code ${code.code} has no rate effective on ${asOfDate}.`);
    }

    const result = computeTax(
      BigInt(input.amountMinor),
      rate.ratePercent.toString(),
      code.treatment,
    );
    return {
      taxCodeId: code.id,
      taxCode: code.code,
      treatment: code.treatment,
      ratePercent: rate.ratePercent.toString(),
      asOfDate,
      taxableAmountMinor: result.taxableMinor.toString(),
      taxAmountMinor: result.taxMinor.toString(),
      totalAmountMinor: (result.taxableMinor + result.taxMinor).toString(),
    };
  }

  /**
   * Freezes the tax snapshot for a set of journal lines at posting time, using each line's current
   * live `taxCodeId` and the rate effective on the journal date. Called inside the same transaction
   * that flips a journal to POSTED, so a later edit to the tax catalog never drifts a posted line.
   */
  async freezeLineSnapshots(
    tx: Prisma.TransactionClient,
    organizationId: string,
    journalDate: string,
    lines: readonly {
      id: string;
      taxCodeId: string | null;
      debitMinor: bigint;
      creditMinor: bigint;
    }[],
  ): Promise<void> {
    const taxCodeIds = Array.from(
      new Set(lines.map((line) => line.taxCodeId).filter((id): id is string => Boolean(id))),
    );
    if (taxCodeIds.length === 0) return;

    const codes = await tx.taxCode.findMany({
      where: { organizationId, id: { in: taxCodeIds } },
      include: { rates: true },
    });
    const codesById = new Map(codes.map((code) => [code.id, code]));

    for (const line of lines) {
      if (!line.taxCodeId) continue;
      const code = codesById.get(line.taxCodeId);
      if (!code)
        throw new BadRequestException('Every taxed journal line must use an active tax code.');
      const rate = effectiveRateAsOf(code.rates, journalDate);
      if (!rate) {
        throw new BadRequestException(
          `Tax code ${code.code} has no rate effective on ${journalDate}.`,
        );
      }
      const amountMinor = line.debitMinor > 0n ? line.debitMinor : line.creditMinor;
      const result = computeTax(amountMinor, rate.ratePercent.toString(), code.treatment);

      await tx.journalLine.update({
        where: { id: line.id },
        data: {
          taxCodeSnapshot: code.code,
          taxTreatmentSnapshot: code.treatment,
          taxRecoverableSnapshot: code.recoverable,
          taxRatePercentSnapshot: rate.ratePercent,
          taxableAmountMinor: result.taxableMinor,
          taxAmountMinor: result.taxMinor,
        },
      });
    }
  }

  private async hasPostedLineHistory(organizationId: string, taxCodeId: string): Promise<boolean> {
    const count = await this.prisma.journalLine.count({
      where: { organizationId, taxCodeId, journal: { status: { in: [...POSTED_STATUSES] } } },
    });
    return count > 0;
  }

  private async assertAccountsBelongToOrganization(
    organizationId: string,
    accountIds: readonly (string | undefined)[],
  ): Promise<void> {
    const ids = Array.from(new Set(accountIds.filter((id): id is string => Boolean(id))));
    if (ids.length === 0) return;
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true },
    });
    if (accounts.length !== ids.length) {
      throw new BadRequestException('Tax account mappings must reference organization accounts.');
    }
  }
}

function isoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function computeTax(
  amountMinor: bigint,
  ratePercent: string,
  treatment: 'EXCLUSIVE' | 'INCLUSIVE',
): { taxableMinor: bigint; taxMinor: bigint } {
  const rateScaled = parseRatePercentToScaled(ratePercent);
  if (treatment === 'INCLUSIVE') {
    const { baseMinor, taxMinor } = splitInclusiveAmount(amountMinor, rateScaled);
    return { taxableMinor: baseMinor, taxMinor };
  }
  return { taxableMinor: amountMinor, taxMinor: taxAmountExclusive(amountMinor, rateScaled) };
}

function taxCodeSummary(
  code: TaxCode & { rates: readonly TaxRate[] },
  currentRate: TaxRate | undefined,
) {
  return {
    id: code.id,
    code: code.code,
    name: code.name,
    treatment: code.treatment,
    recoverable: code.recoverable,
    status: code.status,
    description: code.description,
    salesTaxAccountId: code.salesTaxAccountId,
    purchaseTaxAccountId: code.purchaseTaxAccountId,
    systemSeed: code.systemSeed,
    currentRatePercent: currentRate ? currentRate.ratePercent.toString() : null,
  };
}

function taxRateSummary(rate: TaxRate) {
  return {
    id: rate.id,
    taxCodeId: rate.taxCodeId,
    ratePercent: rate.ratePercent.toString(),
    effectiveFrom: dateOnly(rate.effectiveFrom),
    effectiveTo: rate.effectiveTo ? dateOnly(rate.effectiveTo) : null,
  };
}

function dateOnly(date: Date | string): string {
  return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
}

function taxEvent(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
  eventKey: string,
  metadata: RequestMetadata,
  details: Prisma.InputJsonObject,
) {
  return tx.securityEvent.create({
    data: { userId, organizationId, eventKey, ipHash: metadata.ipHash, metadata: details },
  });
}
