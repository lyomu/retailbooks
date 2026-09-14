import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface ProjectMarginAdvice {
  readonly projectId: string;
  readonly projectName: string;
  readonly unbilledTimeMinor: string;
  readonly unbilledExpenseMinor: string;
  readonly currentMarginPercent: number | null;
  readonly priorMarginPercent: number | null;
  readonly marginErosion: boolean;
}

const PERIOD_DAYS = 30;

/**
 * Deterministic project margin advice: unbilled time/expense figures are the same source rows
 * `projects.unbilled` reports; margin-erosion compares this trailing 30-day window's posted
 * project P&L against the prior 30-day window, reusing the same account-type classification
 * `projects.profitability` already applies. No model call.
 */
@Injectable()
export class ProjectMarginAdviserService {
  constructor(private readonly prisma: PrismaService) {}

  async advise(organizationId: string): Promise<ProjectMarginAdvice[]> {
    const now = new Date();
    const currentStart = addDays(now, -PERIOD_DAYS);
    const priorStart = addDays(now, -2 * PERIOD_DAYS);

    const [unbilled, currentMargins, priorMargins] = await Promise.all([
      // timeMinor/expenseMinor are cast ::bigint below, so they arrive as real JS bigints despite
      // the string-shaped column names -- comparing or returning them as if they were strings (as
      // an earlier version of this method did) either silently defeats the unbilled filter (a
      // bigint is never === a string, so `timeMinor !== '0'` was always true) or throws when a raw
      // bigint reaches JSON.stringify in the HTTP response.
      this.prisma.$queryRaw<
        { projectId: string; projectName: string; timeMinor: bigint; expenseMinor: bigint }[]
      >(Prisma.sql`
        SELECT p.id::text AS "projectId", p.name AS "projectName",
          COALESCE((SELECT SUM(ROUND(te.hours * COALESCE(te.rate_minor, p.default_rate_minor, 0)))::bigint
                    FROM time_entries te WHERE te.organization_id = ${organizationId}::uuid AND te.project_id = p.id
                      AND te.status = 'APPROVED' AND te.billable AND te.invoice_line_id IS NULL), 0) AS "timeMinor",
          COALESCE((SELECT SUM(ROUND(e.total_minor * (1 + COALESCE(pe.markup_percent, 0) / 100)))::bigint
                    FROM project_expenses pe JOIN expenses e ON e.id = pe.expense_id AND e.organization_id = ${organizationId}::uuid
                    WHERE pe.organization_id = ${organizationId}::uuid AND pe.project_id = p.id
                      AND pe.billable AND pe.invoice_line_id IS NULL), 0) AS "expenseMinor"
        FROM projects p WHERE p.organization_id = ${organizationId}::uuid
      `),
      this.marginByProject(organizationId, currentStart, now),
      this.marginByProject(organizationId, priorStart, currentStart),
    ]);

    const currentByProject = new Map(
      currentMargins.map((row) => [row.projectId, row.marginPercent]),
    );
    const priorByProject = new Map(priorMargins.map((row) => [row.projectId, row.marginPercent]));

    return unbilled
      .filter((row) => row.timeMinor !== 0n || row.expenseMinor !== 0n)
      .map((row) => {
        const currentMarginPercent = currentByProject.get(row.projectId) ?? null;
        const priorMarginPercent = priorByProject.get(row.projectId) ?? null;
        const marginErosion =
          currentMarginPercent !== null &&
          priorMarginPercent !== null &&
          currentMarginPercent < priorMarginPercent - 10;
        return {
          projectId: row.projectId,
          projectName: row.projectName,
          unbilledTimeMinor: row.timeMinor.toString(),
          unbilledExpenseMinor: row.expenseMinor.toString(),
          currentMarginPercent,
          priorMarginPercent,
          marginErosion,
        };
      });
  }

  private async marginByProject(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<{ projectId: string; marginPercent: number | null }[]> {
    const rows = await this.prisma.$queryRaw<
      { projectId: string; revenueMinor: bigint; marginMinor: bigint }[]
    >(Prisma.sql`
      SELECT p.id::text AS "projectId",
             -- SUM() over a bigint expression returns PostgreSQL numeric, not bigint; without the
             -- cast, Prisma returns a Decimal that silently fails the === 0n check below and throws
             -- if ever mixed into bigint arithmetic (only reproduces with a non-empty sum, i.e. real
             -- posted activity -- see cash-flow-scenario.service.ts's currentCashPosition for the
             -- same fix).
             SUM(CASE WHEN a.type IN ('REVENUE', 'OTHER_INCOME') THEN jl.credit_minor - jl.debit_minor ELSE 0 END)::bigint AS "revenueMinor",
             SUM(CASE WHEN a.type IN ('REVENUE', 'OTHER_INCOME') THEN jl.credit_minor - jl.debit_minor
                      WHEN a.type IN ('EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE') THEN jl.credit_minor - jl.debit_minor
                      ELSE 0 END)::bigint AS "marginMinor"
      FROM projects p
      JOIN journal_lines jl ON jl.project_id = p.id AND jl.organization_id = ${organizationId}::uuid
      JOIN journals j ON j.id = jl.journal_id AND j.organization_id = ${organizationId}::uuid
      JOIN ledger_accounts a ON a.id = jl.account_id AND a.organization_id = ${organizationId}::uuid
      WHERE p.organization_id = ${organizationId}::uuid AND j.status = 'POSTED'
        AND j.journal_date >= ${from}::date AND j.journal_date < ${to}::date
        AND a.type IN ('REVENUE', 'EXPENSE', 'COST_OF_SALES', 'OTHER_INCOME', 'OTHER_EXPENSE')
      GROUP BY p.id
    `);
    return rows.map((row) => ({
      projectId: row.projectId,
      marginPercent:
        row.revenueMinor === 0n ? null : (Number(row.marginMinor) / Number(row.revenueMinor)) * 100,
    }));
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
