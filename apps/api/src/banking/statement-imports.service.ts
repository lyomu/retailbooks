import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';

import type { UploadedFileLike } from '../attachments/attachments.service.js';
import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { computeBankTransactionFingerprint } from './bank-transaction-fingerprint.js';
import { resolveSuggestion } from './bank-rule-matching.js';
import { parseCsv } from './csv.js';

const MAX_ROWS = 5_000;

/**
 * A byte ceiling to sit in front of {@link MAX_ROWS}, which can only be checked once the file has
 * been read into memory and fully parsed. 5,000 statement rows do not approach 8MB — a real bank
 * export is tens of kilobytes — so this rejects nothing legitimate while bounding what an
 * untrusted upload can make the parser hold.
 */
export const MAX_STATEMENT_BYTES = 8 * 1024 * 1024;

export interface RowOutcome {
  rowNumber: number;
  date: string | null;
  description: string | null;
  reference: string | null;
  amount: string | null;
  outcome: 'IMPORTED' | 'DUPLICATE' | 'FAILED';
  error?: string;
  bankTransactionId?: string;
}

@Injectable()
export class StatementImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, financialAccountId?: string) {
    const imports = await this.prisma.statementImport.findMany({
      where: { organizationId, ...(financialAccountId ? { financialAccountId } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    return imports.map(summarize);
  }

  async detail(organizationId: string, statementImportId: string) {
    const record = await this.findOrThrow(organizationId, statementImportId);
    return summarize(record);
  }

  async failedRows(organizationId: string, statementImportId: string) {
    const record = await this.findOrThrow(organizationId, statementImportId);
    const rows = record.rows as unknown as RowOutcome[];
    return rows.filter((row) => row.outcome === 'FAILED');
  }

  /**
   * CSV-only in V1 (`StatementImportFormat` is an extension seam for OFX/QIF later, not built yet).
   * Expected header row (case-insensitive, any column order): date, description, amount, and
   * optionally reference. `amount` is signed: positive = inflow, negative = outflow.
   */
  async import(
    context: OrganizationContext,
    user: PublicUser,
    financialAccountId: string,
    file: UploadedFileLike,
    metadata: RequestMetadata,
  ) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id: financialAccountId, organizationId: context.id },
    });
    if (!account) throw new NotFoundException('Financial account not found.');
    if (!account.active)
      throw new BadRequestException('Cannot import a statement into an inactive account.');

    if (file.size > MAX_STATEMENT_BYTES) {
      throw new BadRequestException('A statement file is limited to 8MB.');
    }

    const text = file.buffer.toString('utf8');
    const table = parseCsv(text);
    if (table.length === 0) throw new BadRequestException('The file has no rows.');
    if (table.length - 1 > MAX_ROWS) {
      throw new BadRequestException(`A single import is limited to ${MAX_ROWS} rows.`);
    }

    const header = table[0]!.map((cell) => cell.trim().toLowerCase());
    const dateIndex = header.indexOf('date');
    const descriptionIndex = header.indexOf('description');
    const amountIndex = header.indexOf('amount');
    const referenceIndex = header.indexOf('reference');
    if (dateIndex === -1 || descriptionIndex === -1 || amountIndex === -1) {
      throw new BadRequestException(
        'The header row must include "date", "description", and "amount" columns.',
      );
    }

    const rules = await this.prisma.bankRule.findMany({ where: { organizationId: context.id } });

    const outcomes: RowOutcome[] = [];
    let importedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    await this.prisma.$transaction(
      async (tx) => {
        for (let rowNumber = 1; rowNumber < table.length; rowNumber += 1) {
          const cells = table[rowNumber]!;
          const rawDate = cells[dateIndex]?.trim() ?? '';
          const rawDescription = cells[descriptionIndex]?.trim() ?? '';
          const rawAmount = cells[amountIndex]?.trim() ?? '';
          const rawReference = referenceIndex >= 0 ? (cells[referenceIndex]?.trim() ?? '') : '';

          const parsed = parseRow(rawDate, rawDescription, rawAmount);
          if (!parsed.ok) {
            failedCount += 1;
            outcomes.push({
              rowNumber,
              date: rawDate || null,
              description: rawDescription || null,
              reference: rawReference || null,
              amount: rawAmount || null,
              outcome: 'FAILED',
              error: parsed.error,
            });
            continue;
          }

          const fingerprint = computeBankTransactionFingerprint({
            financialAccountId,
            transactionDate: parsed.date,
            direction: parsed.direction,
            amountMinor: parsed.amountMinor,
            description: rawDescription,
            reference: rawReference || null,
          });

          const existing = await tx.bankTransaction.findUnique({
            where: { financialAccountId_fingerprint: { financialAccountId, fingerprint } },
            select: { id: true },
          });
          if (existing) {
            duplicateCount += 1;
            outcomes.push({
              rowNumber,
              date: parsed.date,
              description: rawDescription,
              reference: rawReference || null,
              amount: rawAmount,
              outcome: 'DUPLICATE',
              bankTransactionId: existing.id,
            });
            continue;
          }

          const suggestion = resolveSuggestion(rules, {
            description: rawDescription,
            reference: rawReference || null,
            amountMinor: parsed.amountMinor,
            direction: parsed.direction,
          });

          const created = await tx.bankTransaction.create({
            data: {
              organizationId: context.id,
              financialAccountId,
              transactionDate: isoDate(parsed.date),
              description: rawDescription,
              reference: rawReference || null,
              direction: parsed.direction,
              amountMinor: parsed.amountMinor,
              currency: account.currency,
              fingerprint,
              suggestedAccountId: suggestion?.suggestedAccountId ?? null,
              suggestedContactId: suggestion?.suggestedContactId ?? null,
              suggestedVendorId: suggestion?.suggestedVendorId ?? null,
              suggestedTags: suggestion?.suggestedTags ?? [],
              appliedFromRuleId: suggestion?.ruleId ?? null,
            },
          });
          importedCount += 1;
          outcomes.push({
            rowNumber,
            date: parsed.date,
            description: rawDescription,
            reference: rawReference || null,
            amount: rawAmount,
            outcome: 'IMPORTED',
            bankTransactionId: created.id,
          });
        }

        await tx.financialAccount.update({
          where: { id: financialAccountId },
          data: { lastActivityAt: new Date() },
        });
      },
      { timeout: 60_000 },
    );

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.statementImport.create({
        data: {
          organizationId: context.id,
          financialAccountId,
          format: 'CSV',
          status:
            failedCount === 0 ? 'IMPORTED' : importedCount > 0 ? 'PARTIALLY_IMPORTED' : 'FAILED',
          fileName: file.originalname,
          totalRows: table.length - 1,
          importedCount,
          duplicateCount,
          failedCount,
          rows: outcomes as unknown as Prisma.InputJsonValue,
          createdByUserId: user.id,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'banking.statement_imported',
        entityType: 'statement_import',
        entityId: created.id,
        action: AuditAction.CREATE,
        after: { fileName: file.originalname, importedCount, duplicateCount, failedCount },
        ipHash: metadata.ipHash,
      });
      return created;
    });

    return summarize(record);
  }

  private async findOrThrow(organizationId: string, statementImportId: string) {
    const record = await this.prisma.statementImport.findFirst({
      where: { id: statementImportId, organizationId },
    });
    if (!record) throw new NotFoundException('Statement import not found.');
    return record;
  }
}

function parseRow(
  rawDate: string,
  rawDescription: string,
  rawAmount: string,
):
  | { ok: true; date: string; direction: 'INFLOW' | 'OUTFLOW'; amountMinor: bigint }
  | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return { ok: false, error: 'date must be YYYY-MM-DD' };
  }
  if (!rawDescription) {
    return { ok: false, error: 'description is required' };
  }
  const normalizedAmount = rawAmount.replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalizedAmount)) {
    return { ok: false, error: 'amount must be a decimal number' };
  }
  const [whole, fraction = ''] = normalizedAmount.replace('-', '').split('.');
  const minor = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
  if (minor === 0n) {
    return { ok: false, error: 'amount must be non-zero' };
  }
  const direction: 'INFLOW' | 'OUTFLOW' = normalizedAmount.startsWith('-') ? 'OUTFLOW' : 'INFLOW';
  return { ok: true, date: rawDate, direction, amountMinor: minor };
}

function isoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function summarize(record: {
  id: string;
  financialAccountId: string;
  format: string;
  status: string;
  fileName: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    financialAccountId: record.financialAccountId,
    format: record.format,
    status: record.status,
    fileName: record.fileName,
    totalRows: record.totalRows,
    importedCount: record.importedCount,
    duplicateCount: record.duplicateCount,
    failedCount: record.failedCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
