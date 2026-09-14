import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';

export interface DocumentDiscrepancy {
  readonly attachmentId: string;
  readonly filename: string;
  readonly kind: 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH' | 'DATE_MISMATCH' | 'POSSIBLE_DUPLICATE';
  readonly detail: string;
}

const DATE_TOLERANCE_DAYS = 3;

/**
 * Deterministic document-versus-entry comparison: for each of an Expense's reviewed receipts,
 * compares the OCR'd candidate total/currency/date against what was actually recorded on the
 * Expense, plus surfaces the duplicate-content signal 13D already computed. No model call; every
 * flag is a plain arithmetic/string/date comparison. Advisory only.
 */
@Injectable()
export class DocumentDiscrepancyService {
  constructor(private readonly prisma: PrismaService) {}

  async forExpense(organizationId: string, expenseId: string): Promise<DocumentDiscrepancy[]> {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, organizationId },
      select: { totalMinor: true, currency: true, expenseDate: true },
    });
    if (!expense) return [];

    const extractions = await this.prisma.documentExtraction.findMany({
      where: {
        organizationId,
        entityType: 'EXPENSE',
        entityId: expenseId,
        status: 'READY_FOR_REVIEW',
      },
      include: { attachment: { select: { filename: true } } },
    });

    const discrepancies: DocumentDiscrepancy[] = [];
    for (const extraction of extractions) {
      const filename = extraction.attachment.filename;

      if (extraction.duplicateOfAttachmentId) {
        discrepancies.push({
          attachmentId: extraction.attachmentId,
          filename,
          kind: 'POSSIBLE_DUPLICATE',
          detail: 'This file has the same content as another uploaded attachment.',
        });
      }

      if (
        extraction.candidateTotalMinor !== null &&
        extraction.candidateTotalMinor !== expense.totalMinor
      ) {
        discrepancies.push({
          attachmentId: extraction.attachmentId,
          filename,
          kind: 'AMOUNT_MISMATCH',
          detail: `Receipt shows ${extraction.candidateTotalMinor.toString()} minor units; the expense records ${expense.totalMinor.toString()}.`,
        });
      }

      if (
        extraction.candidateCurrency !== null &&
        extraction.candidateCurrency !== expense.currency
      ) {
        discrepancies.push({
          attachmentId: extraction.attachmentId,
          filename,
          kind: 'CURRENCY_MISMATCH',
          detail: `Receipt shows ${extraction.candidateCurrency}; the expense is recorded in ${expense.currency}.`,
        });
      }

      if (extraction.candidateDate !== null) {
        const dayDiff = Math.abs(
          Math.round(
            (extraction.candidateDate.getTime() - expense.expenseDate.getTime()) / 86_400_000,
          ),
        );
        if (dayDiff > DATE_TOLERANCE_DAYS) {
          discrepancies.push({
            attachmentId: extraction.attachmentId,
            filename,
            kind: 'DATE_MISMATCH',
            detail: `Receipt date is ${dayDiff} day(s) from the recorded expense date.`,
          });
        }
      }
    }

    return discrepancies;
  }
}
