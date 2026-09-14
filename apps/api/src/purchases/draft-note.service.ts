import { Injectable, NotFoundException } from '@nestjs/common';

import { AiSuggestionsStore } from '../ai/ai-suggestions.store.js';
import { PrismaService } from '../database/prisma.service.js';

const CAPABILITY = 'DRAFT_NOTE';

/**
 * Deterministic draft text from the Expense's own recorded facts -- no model call, nothing
 * invented. The caller pastes the (editable) result into the existing comment box
 * (`collaboration.comments.create`); this service never posts anything itself.
 */
@Injectable()
export class DraftNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suggestions: AiSuggestionsStore,
  ) {}

  async draftForExpense(
    organizationId: string,
    expenseId: string,
  ): Promise<{ suggestionId: string; text: string }> {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, organizationId },
      include: {
        payeeVendor: { select: { displayName: true } },
        category: { select: { name: true } },
      },
    });
    if (!expense) throw new NotFoundException('Expense not found.');

    const vendor = expense.payeeVendor?.displayName ?? expense.payeeName ?? 'an unspecified vendor';
    const category = expense.category?.name ?? 'an uncategorized expense';
    const amount = (Number(expense.totalMinor || expense.amountMinor) / 100).toFixed(2);
    const date = expense.expenseDate.toISOString().slice(0, 10);
    const text = `${expense.currency} ${amount} paid to ${vendor} on ${date}, recorded under ${category}.`;

    const created = await this.suggestions.create({
      organizationId,
      capability: CAPABILITY,
      entityType: 'EXPENSE',
      entityId: expenseId,
      payload: { text },
      reason: 'Deterministic summary of the recorded expense facts.',
    });

    return { suggestionId: created.id, text };
  }
}
