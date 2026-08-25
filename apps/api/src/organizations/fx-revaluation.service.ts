import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditAction, FiscalPeriodStatus, JournalStatus } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  PostingRule,
  PostingRuleLineSpec,
  PostingRuleSourceContext,
} from '../posting-rules/posting-rule.js';
import { accountIdRef, systemKeyRef } from '../posting-rules/posting-rule.js';
import { PostingRulesService } from '../posting-rules/posting-rules.service.js';
import { writeAuditEvent } from './audit-event.js';
import { CurrencyService } from './currency.service.js';
import { LedgerService } from './ledger.service.js';
import type { OrganizationContext } from './organization-context.js';

interface RevaluationSource extends PostingRuleSourceContext {
  lines: readonly PostingRuleLineSpec[];
}

const MONETARY_TYPES = new Set(['ASSET', 'LIABILITY']);

/**
 * Period-end FX revaluation. Restates each foreign-currency net monetary position -- grouped per
 * account and currency from posted journals' frozen foreign amounts -- to the reporting-rate value
 * as of the run date, and posts only the aggregate difference through the declarative rule library
 * (`sourceType 'FX_REVALUATION'`, gains to `fx_gain`, losses to `fx_loss`). This is deliberately
 * distinct from `LedgerService#prepareFxPosting`'s per-journal transaction-date conversion, which
 * stays untouched.
 */
@Injectable()
export class FxRevaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rules: PostingRulesService,
    private readonly currencies: CurrencyService,
  ) {}

  private readonly revaluationRule: PostingRule<RevaluationSource> = {
    event: 'FX_REVALUATION_RUN',
    sourceType: 'FX_REVALUATION',
    version: 1,
    describe: (source) => `FX revaluation as of ${source.journalDate.toISOString().slice(0, 10)}`,
    lines: (source) => source.lines,
  };

  async list(organizationId: string) {
    const runs = await this.prisma.fxRevaluationRun.findMany({
      where: { organizationId },
      orderBy: [{ asOfDate: 'desc' }],
      take: 100,
    });
    return runs.map((run) => ({
      id: run.id,
      asOfDate: dateOnly(run.asOfDate),
      baseCurrency: run.baseCurrency,
      journalId: run.journalId,
      gainMinor: run.gainMinor.toString(),
      lossMinor: run.lossMinor.toString(),
      createdAt: run.createdAt.toISOString(),
    }));
  }

  async run(
    context: OrganizationContext,
    user: PublicUser,
    asOfDateInput: string,
    metadata: RequestMetadata,
  ) {
    const asOfDate = isoDate(asOfDateInput);

    const existing = await this.prisma.fxRevaluationRun.findUnique({
      where: { organizationId_asOfDate: { organizationId: context.id, asOfDate } },
    });
    if (existing) {
      throw new ConflictException(
        `A revaluation for ${dateOnly(asOfDate)} already exists (journal ${existing.journalId}).`,
      );
    }

    const period = await this.prisma.fiscalPeriod.findFirst({
      where: {
        organizationId: context.id,
        startsOn: { lte: isoDate(dateOnly(asOfDate)) },
        endsOn: { gte: isoDate(dateOnly(asOfDate)) },
      },
      select: { status: true, code: true },
    });
    if (!period)
      throw new BadRequestException('Create a fiscal period covering the run date first.');
    if (period.status !== FiscalPeriodStatus.OPEN) {
      throw new ConflictException(`Fiscal period ${period.code} is not open.`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.id },
        select: { baseCurrency: true },
      });
      const baseCurrency = organization.baseCurrency;

      // Net foreign-currency position per (monetary account, currency), from frozen line data.
      const rows = await tx.journalLine.findMany({
        where: {
          organizationId: context.id,
          foreignAmountMinor: { not: null },
          journal: {
            status: { in: [JournalStatus.POSTED, JournalStatus.REVERSED] },
            currency: { not: baseCurrency },
          },
        },
        select: {
          accountId: true,
          debitMinor: true,
          creditMinor: true,
          foreignAmountMinor: true,
          account: { select: { type: true } },
          journal: { select: { currency: true } },
        },
      });

      interface Position {
        currency: string;
        foreignNet: bigint;
        baseNet: bigint;
      }
      const positionsByAccount = new Map<string, Map<string, Position>>();
      for (const row of rows) {
        if (!MONETARY_TYPES.has(row.account.type)) continue;
        const foreignAmount = row.foreignAmountMinor ?? 0n;
        if (foreignAmount === 0n) continue;
        const signedForeign = row.debitMinor > 0n ? foreignAmount : -foreignAmount;
        const byCurrency = positionsByAccount.get(row.accountId) ?? new Map<string, Position>();
        const position = byCurrency.get(row.journal.currency) ?? {
          currency: row.journal.currency,
          foreignNet: 0n,
          baseNet: 0n,
        };
        position.foreignNet += signedForeign;
        position.baseNet += row.debitMinor - row.creditMinor;
        byCurrency.set(row.journal.currency, position);
        positionsByAccount.set(row.accountId, byCurrency);
      }

      // Restate each nonzero position at the effective reporting rate; keep the aggregate delta.
      const deltas = new Map<string, bigint>();
      for (const [accountId, byCurrency] of positionsByAccount) {
        let accountDelta = 0n;
        for (const position of byCurrency.values()) {
          if (position.foreignNet === 0n && position.baseNet === 0n) continue;
          const resolved = await this.currencies.resolveRate(
            tx,
            context.id,
            baseCurrency,
            position.currency,
            asOfDate,
            undefined,
          );
          const negative = position.foreignNet < 0n;
          const converted = this.currencies.convert({
            foreignAmountMinor: negative ? -position.foreignNet : position.foreignNet,
            exchangeRate: resolved.rate,
            base: resolved.base,
            quote: resolved.quote,
          });
          const restatedBase = negative ? -converted : converted;
          accountDelta += restatedBase - position.baseNet;
        }
        if (accountDelta !== 0n) deltas.set(accountId, accountDelta);
      }

      if (deltas.size === 0) {
        throw new BadRequestException('No open foreign-currency monetary positions to revalue.');
      }

      // Weakened positions (negative deltas, credited monetary accounts) are a loss; strengthened
      // ones a gain.
      let totalGain = 0n;
      let totalLoss = 0n;
      for (const delta of deltas.values()) {
        if (delta > 0n) totalGain += delta;
        else totalLoss += -delta;
      }

      // Offsetting legs against the configured FX accounts: weakened positions (negative deltas,
      // credited monetary accounts) are a realized loss; strengthened ones a gain.
      const lines: RevaluationSource['lines'] = [
        ...[...deltas.entries()].map(([accountId, delta]) => ({
          account: accountIdRef(accountId),
          description: 'FX revaluation adjustment',
          ...(delta > 0n
            ? { debitMinor: delta, creditMinor: 0n }
            : { debitMinor: 0n, creditMinor: -delta }),
        })),
        ...(totalLoss > 0n
          ? [
              {
                account: systemKeyRef('fx_loss'),
                description: 'Foreign exchange loss',
                debitMinor: totalLoss,
                creditMinor: 0n,
              },
            ]
          : []),
        ...(totalGain > 0n
          ? [
              {
                account: systemKeyRef('fx_gain'),
                description: 'Foreign exchange gain',
                debitMinor: 0n,
                creditMinor: totalGain,
              },
            ]
          : []),
      ];

      const journal = await this.rules.post(
        context,
        user,
        this.revaluationRule,
        {
          sourceId: `REVAL:${dateOnly(asOfDate)}`,
          journalDate: asOfDate,
          currency: baseCurrency,
          lines,
        },
        metadata,
        `RUN:${context.id}:${dateOnly(asOfDate)}`,
        tx,
      );

      // Gains/losses read off the balancing legs against fx_gain/fx_loss accounts.
      const gainAccount = await this.ledger.accountBySystemKey(context.id, 'fx_gain', tx);
      const lossAccount = await this.ledger.accountBySystemKey(context.id, 'fx_loss', tx);
      const gainLine = journal.lines.find((line) => line.accountId === gainAccount.id);
      const lossLine = journal.lines.find((line) => line.accountId === lossAccount.id);
      totalGain = gainLine ? BigInt(gainLine.creditMinor) : 0n;
      totalLoss = lossLine ? BigInt(lossLine.debitMinor) : 0n;

      const run = await tx.fxRevaluationRun.create({
        data: {
          organizationId: context.id,
          asOfDate,
          baseCurrency,
          journalId: journal.id,
          gainMinor: totalGain,
          lossMinor: totalLoss,
          createdByUserId: user.id,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'journals.fx_revaluation_run',
        entityType: 'fx_revaluation_run',
        entityId: run.id,
        action: AuditAction.CREATE,
        after: { journalId: journal.id, asOfDate: dateOnly(asOfDate) },
        ipHash: metadata.ipHash,
      });

      return {
        id: run.id,
        journalId: journal.id,
        asOfDate: dateOnly(asOfDate),
        gainMinor: totalGain.toString(),
        lossMinor: totalLoss.toString(),
        adjustedAccounts: deltas.size,
      };
    });

    return result;
  }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
