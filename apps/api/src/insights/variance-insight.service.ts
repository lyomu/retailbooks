import { Injectable } from '@nestjs/common';

import { AiSuggestionsStore } from '../ai/ai-suggestions.store.js';
import { PrismaService } from '../database/prisma.service.js';

export interface VarianceInsight {
  readonly suggestionId: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly currentMinor: string;
  readonly baselineMinor: string;
  readonly variancePercent: number | null;
  readonly direction: 'increase' | 'decrease' | 'new';
  readonly reason: string;
}

const CAPABILITY = 'VARIANCE_INSIGHT';
const BASELINE_MONTHS = 3;
const SIGNIFICANT_VARIANCE_PERCENT = 30;

/**
 * Deterministic spend-variance detection: this calendar month's posted Expense spend per category
 * against the trailing 3-month average for the same category. Reproducible given the same "as of"
 * date -- no model call, no randomness. Advisory only: dismissible, never mutates anything.
 */
@Injectable()
export class VarianceInsightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suggestions: AiSuggestionsStore,
  ) {}

  async detect(organizationId: string): Promise<VarianceInsight[]> {
    const now = new Date();
    const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const baselineStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - BASELINE_MONTHS, 1),
    );

    const [currentGroups, baselineGroups] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['categoryId'],
        where: {
          organizationId,
          status: { in: ['APPROVED', 'POSTED'] },
          categoryId: { not: null },
          expenseDate: { gte: currentStart },
        },
        _sum: { totalMinor: true },
      }),
      this.prisma.expense.groupBy({
        by: ['categoryId'],
        where: {
          organizationId,
          status: { in: ['APPROVED', 'POSTED'] },
          categoryId: { not: null },
          expenseDate: { gte: baselineStart, lt: currentStart },
        },
        _sum: { totalMinor: true },
      }),
    ]);

    const categoryIds = new Set(
      [...currentGroups, ...baselineGroups]
        .map((group) => group.categoryId)
        .filter((id): id is string => id !== null),
    );
    if (categoryIds.size === 0) return [];

    const categories = await this.prisma.expenseCategory.findMany({
      where: { organizationId, id: { in: [...categoryIds] } },
      select: { id: true, name: true },
    });
    const categoryName = new Map(categories.map((category) => [category.id, category.name]));
    const currentByCategory = new Map(
      currentGroups.map((group) => [group.categoryId, group._sum.totalMinor ?? 0n]),
    );
    const baselineByCategory = new Map(
      baselineGroups.map((group) => [group.categoryId, group._sum.totalMinor ?? 0n]),
    );

    const insights: VarianceInsight[] = [];
    for (const categoryId of categoryIds) {
      const currentMinor = currentByCategory.get(categoryId) ?? 0n;
      const baselineTotalMinor = baselineByCategory.get(categoryId) ?? 0n;
      const baselineMonthlyMinor = baselineTotalMinor / BigInt(BASELINE_MONTHS);
      if (baselineMonthlyMinor === 0n && currentMinor === 0n) continue;

      const variancePercent =
        baselineMonthlyMinor === 0n
          ? null
          : Number(((currentMinor - baselineMonthlyMinor) * 10_000n) / baselineMonthlyMinor) / 100;
      const direction: VarianceInsight['direction'] =
        variancePercent === null ? 'new' : variancePercent > 0 ? 'increase' : 'decrease';
      const significant =
        variancePercent === null
          ? currentMinor > 0n
          : Math.abs(variancePercent) >= SIGNIFICANT_VARIANCE_PERCENT;
      if (!significant) continue;

      const name = categoryName.get(categoryId) ?? 'Unknown category';
      const reason =
        variancePercent === null
          ? `${name} had no spend in the prior ${BASELINE_MONTHS} months but has posted spend this month.`
          : `${name} spend is ${Math.abs(variancePercent).toFixed(0)}% ${direction} vs. its trailing ${BASELINE_MONTHS}-month average.`;

      const existing = await this.suggestions.findPending(
        organizationId,
        CAPABILITY,
        'EXPENSE_CATEGORY',
        categoryId,
      );
      const suggestionId =
        existing?.id ??
        (
          await this.suggestions.create({
            organizationId,
            capability: CAPABILITY,
            entityType: 'EXPENSE_CATEGORY',
            entityId: categoryId,
            payload: {
              currentMinor: currentMinor.toString(),
              baselineMinor: baselineMonthlyMinor.toString(),
              variancePercent,
              direction,
            },
            reason,
          })
        ).id;

      insights.push({
        suggestionId,
        categoryId,
        categoryName: name,
        currentMinor: currentMinor.toString(),
        baselineMinor: baselineMonthlyMinor.toString(),
        variancePercent,
        direction,
        reason,
      });
    }

    return insights.sort(
      (a, b) => Math.abs(b.variancePercent ?? 100) - Math.abs(a.variancePercent ?? 100),
    );
  }
}
