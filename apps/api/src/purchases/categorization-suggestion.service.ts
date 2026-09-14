import { Injectable } from '@nestjs/common';

import { AiSuggestionsStore } from '../ai/ai-suggestions.store.js';
import { PrismaService } from '../database/prisma.service.js';

export interface CategorizationCandidate {
  readonly suggestionId: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly occurrences: number;
  readonly totalObserved: number;
  readonly reason: string;
}

const CAPABILITY = 'EXPENSE_CATEGORIZATION';

/**
 * Deterministic historical-precedent categorization: no model call, just "what category has this
 * vendor's past posted Expenses most often used." A user must still accept it; an approved
 * `WorkflowRule` (Phase 10's existing condition/action engine) is the only thing allowed to
 * automate categorization for future events, and wiring that hand-off is explicitly optional and
 * deferred -- this slice only produces the reviewable candidate.
 */
@Injectable()
export class CategorizationSuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suggestions: AiSuggestionsStore,
  ) {}

  async suggestForVendor(
    organizationId: string,
    vendorId: string,
  ): Promise<CategorizationCandidate | null> {
    const existing = await this.suggestions.findPending(
      organizationId,
      CAPABILITY,
      'VENDOR',
      vendorId,
    );
    if (existing) {
      const payload = existing.payload as {
        categoryId: string;
        categoryName: string;
        occurrences: number;
        totalObserved: number;
      };
      return { suggestionId: existing.id, reason: existing.reason ?? '', ...payload };
    }

    const totalObserved = await this.prisma.expense.count({
      where: { organizationId, payeeVendorId: vendorId, status: { in: ['APPROVED', 'POSTED'] } },
    });
    if (totalObserved === 0) return null;

    const grouped = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      where: {
        organizationId,
        payeeVendorId: vendorId,
        status: { in: ['APPROVED', 'POSTED'] },
        categoryId: { not: null },
      },
      _count: { categoryId: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: 1,
    });
    const top = grouped[0];
    if (!top?.categoryId) return null;

    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: top.categoryId, organizationId },
      select: { id: true, name: true },
    });
    if (!category) return null;

    const occurrences = top._count.categoryId;
    const reason = `Used in ${occurrences} of the last ${totalObserved} posted expenses from this vendor.`;
    const created = await this.suggestions.create({
      organizationId,
      capability: CAPABILITY,
      entityType: 'VENDOR',
      entityId: vendorId,
      payload: { categoryId: category.id, categoryName: category.name, occurrences, totalObserved },
      reason,
    });

    return {
      suggestionId: created.id,
      categoryId: category.id,
      categoryName: category.name,
      occurrences,
      totalObserved,
      reason,
    };
  }
}
