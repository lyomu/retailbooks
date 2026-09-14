import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface CashFlowWeek {
  readonly weekStart: string;
  readonly expectedInflowsMinor: string;
  readonly expectedOutflowsMinor: string;
  readonly cumulativeBalanceMinor: string;
}

export interface CashFlowScenario {
  readonly openingBalanceMinor: string;
  readonly onTime: readonly CashFlowWeek[];
  readonly delayedReceipts: readonly CashFlowWeek[];
}

const WEEKS = 12;
const RECEIPT_DELAY_DAYS = 30;

/**
 * Deterministic cash-flow projection: opening cash position (posted movements on cash-class
 * accounts) plus already-open, already-due-dated invoice/bill balances bucketed by week. No model
 * call, no invented figures -- "delayedReceipts" is a mechanical +30-day shift of the same real AR
 * balances, not a probabilistic forecast. This is a planning aid; it never posts or schedules
 * anything.
 */
@Injectable()
export class CashFlowScenarioService {
  constructor(private readonly prisma: PrismaService) {}

  async project(organizationId: string): Promise<CashFlowScenario> {
    const openingBalanceMinor = await this.currentCashPosition(organizationId);

    const [receivables, payables] = await Promise.all([
      this.prisma.$queryRaw<{ dueDate: Date; balanceMinor: bigint }[]>(Prisma.sql`
        SELECT due_date AS "dueDate", balance_minor AS "balanceMinor"
        FROM invoices
        WHERE organization_id = ${organizationId}::uuid
          AND status NOT IN ('DRAFT', 'VOID', 'PAID') AND balance_minor <> 0
      `),
      this.prisma.$queryRaw<{ dueDate: Date; balanceMinor: bigint }[]>(Prisma.sql`
        SELECT due_date AS "dueDate", balance_minor AS "balanceMinor"
        FROM bills
        WHERE organization_id = ${organizationId}::uuid
          AND status NOT IN ('DRAFT', 'VOID', 'PAID') AND balance_minor <> 0
      `),
    ]);

    const weekStarts = buildWeekStarts(WEEKS);
    const onTime = bucketByWeek(weekStarts, receivables, payables, openingBalanceMinor, 0);
    const delayedReceipts = bucketByWeek(
      weekStarts,
      receivables,
      payables,
      openingBalanceMinor,
      RECEIPT_DELAY_DAYS,
    );

    return { openingBalanceMinor: openingBalanceMinor.toString(), onTime, delayedReceipts };
  }

  /** Signed net movement on cash-class accounts (the same account set `financial.cash-flow`
   * reports on): bank_default system accounts, or any account backing a FinancialAccount. */
  private async currentCashPosition(organizationId: string): Promise<bigint> {
    // SUM() over a bigint expression returns PostgreSQL `numeric`, not `bigint` -- an explicit
    // cast is required, or Prisma returns something that throws "Cannot mix BigInt and other
    // types" the moment it's used in bigint arithmetic below (only reproduces with a non-null
    // sum, i.e. real posted activity -- a fresh, empty organization never triggers it).
    const rows = await this.prisma.$queryRaw<{ balance: bigint | null }[]>(Prisma.sql`
      SELECT SUM(jl.debit_minor - jl.credit_minor)::bigint AS balance
      FROM journal_lines jl
      JOIN journals j ON j.id = jl.journal_id AND j.organization_id = ${organizationId}::uuid
      JOIN ledger_accounts a ON a.id = jl.account_id AND a.organization_id = ${organizationId}::uuid
      WHERE jl.organization_id = ${organizationId}::uuid AND j.status = 'POSTED'
        AND (a.system_key = 'bank_default' OR EXISTS (
          SELECT 1 FROM financial_accounts fa
          WHERE fa.organization_id = ${organizationId}::uuid AND fa.gl_account_id = a.id
        ))
    `);
    return rows[0]?.balance ?? 0n;
  }
}

function buildWeekStarts(weeks: number): Date[] {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Array.from({ length: weeks }, (_, index) => addDays(start, index * 7));
}

function bucketByWeek(
  weekStarts: readonly Date[],
  receivables: readonly { dueDate: Date; balanceMinor: bigint }[],
  payables: readonly { dueDate: Date; balanceMinor: bigint }[],
  openingBalanceMinor: bigint,
  receiptDelayDays: number,
): CashFlowWeek[] {
  const weeks: CashFlowWeek[] = [];
  let cumulative = openingBalanceMinor;
  for (let index = 0; index < weekStarts.length; index += 1) {
    const weekStart = weekStarts[index]!;
    const weekEnd = addDays(weekStart, 7);
    const inflows = receivables
      .filter((row) => {
        const effectiveDue = addDays(row.dueDate, receiptDelayDays);
        return effectiveDue >= weekStart && effectiveDue < weekEnd;
      })
      .reduce((sum, row) => sum + row.balanceMinor, 0n);
    const outflows = payables
      .filter((row) => row.dueDate >= weekStart && row.dueDate < weekEnd)
      .reduce((sum, row) => sum + row.balanceMinor, 0n);
    cumulative = cumulative + inflows - outflows;
    weeks.push({
      weekStart: weekStart.toISOString().slice(0, 10),
      expectedInflowsMinor: inflows.toString(),
      expectedOutflowsMinor: outflows.toString(),
      cumulativeBalanceMinor: cumulative.toString(),
    });
  }
  return weeks;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
