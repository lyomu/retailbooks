import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  reportFiltersSchema,
  type ReportDefinition,
  type ReportFilters,
  type ReportKey,
  type ReportRow,
} from '@retailbooks/contracts';

import type { RequestMetadata } from '../auth/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { REPORT_DEFINITIONS, reportDefinitionFor } from './report-registry.js';
import type {
  CreateSavedReportDto,
  ReportQueryDto,
  UpdateSavedReportDto,
} from './reporting.dto.js';

type DbRow = Record<string, unknown> & {
  id: string;
  source_type?: string | null;
  source_id?: string | null;
  href?: string | null;
};

interface QueryResult {
  rows: ReportRow[];
  totals: Record<string, string | number | boolean | null>;
  totalRows: number;
}

@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  definitions(): readonly ReportDefinition[] {
    return REPORT_DEFINITIONS;
  }

  async filterOptions(organizationId: string) {
    const [projects, tags] = await Promise.all([
      this.prisma.project.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, status: true },
      }),
      this.prisma.tag.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, status: true },
      }),
    ]);
    return { projects, tags };
  }

  async run(organizationId: string, key: ReportKey, input: ReportQueryDto) {
    const definition = reportDefinitionFor(key);
    const filters = this.normalizeFilters(definition, input);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    if (!organization) throw new NotFoundException('Organization not found.');

    const primary = await this.execute(organizationId, key, filters);
    let comparison: null | {
      from: string;
      to: string;
      rows: ReportRow[];
      totals: Record<string, string | number | boolean | null>;
    } = null;
    if (filters.comparisonFrom && filters.comparisonTo) {
      const compared = await this.execute(organizationId, key, {
        ...filters,
        from: filters.comparisonFrom,
        to: filters.comparisonTo,
        comparisonFrom: undefined,
        comparisonTo: undefined,
      });
      comparison = {
        from: filters.comparisonFrom,
        to: filters.comparisonTo,
        rows: compared.rows,
        totals: compared.totals,
      };
    }

    return {
      definition,
      filters,
      baseCurrency: organization.baseCurrency,
      rows: primary.rows,
      totals: primary.totals,
      comparison,
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        totalRows: primary.totalRows,
      },
    };
  }

  async listSaved(organizationId: string, userId: string) {
    const reports = await this.prisma.savedReport.findMany({
      where: { organizationId, createdByUserId: userId },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });
    return reports.map(serializeSavedReport);
  }

  async createSaved(
    organization: { id: string },
    actor: { id: string },
    input: CreateSavedReportDto,
    metadata: RequestMetadata,
  ) {
    reportDefinitionFor(input.reportKey);
    const filters = reportFiltersSchema.partial().parse(input.filters);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.savedReport.create({
        data: {
          organizationId: organization.id,
          createdByUserId: actor.id,
          name: input.name,
          reportKey: input.reportKey,
          filters,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: organization.id,
        actorUserId: actor.id,
        eventKey: 'report.saved_created',
        entityType: 'SavedReport',
        entityId: created.id,
        action: 'CREATE',
        after: savedAuditShape(created),
        metadata: { userAgent: metadata.userAgent },
        ipHash: metadata.ipHash,
      });
      return serializeSavedReport(created);
    });
  }

  async updateSaved(
    organization: { id: string },
    actor: { id: string },
    savedReportId: string,
    input: UpdateSavedReportDto,
    metadata: RequestMetadata,
  ) {
    if (input.reportKey) reportDefinitionFor(input.reportKey);
    const parsedFilters = input.filters
      ? reportFiltersSchema.partial().parse(input.filters)
      : undefined;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.savedReport.findFirst({
        where: { id: savedReportId, organizationId: organization.id, createdByUserId: actor.id },
      });
      if (!existing) throw new NotFoundException('Saved report not found.');
      const updated = await tx.savedReport.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          reportKey: input.reportKey,
          filters: parsedFilters,
        },
      });
      await writeAuditEvent(tx, {
        organizationId: organization.id,
        actorUserId: actor.id,
        eventKey: 'report.saved_updated',
        entityType: 'SavedReport',
        entityId: updated.id,
        action: 'UPDATE',
        before: savedAuditShape(existing),
        after: savedAuditShape(updated),
        metadata: { userAgent: metadata.userAgent },
        ipHash: metadata.ipHash,
      });
      return serializeSavedReport(updated);
    });
  }

  async deleteSaved(
    organization: { id: string },
    actor: { id: string },
    savedReportId: string,
    metadata: RequestMetadata,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.savedReport.findFirst({
        where: { id: savedReportId, organizationId: organization.id, createdByUserId: actor.id },
      });
      if (!existing) throw new NotFoundException('Saved report not found.');
      await tx.savedReport.delete({ where: { id: existing.id } });
      await writeAuditEvent(tx, {
        organizationId: organization.id,
        actorUserId: actor.id,
        eventKey: 'report.saved_deleted',
        entityType: 'SavedReport',
        entityId: existing.id,
        action: 'DELETE',
        before: savedAuditShape(existing),
        metadata: { userAgent: metadata.userAgent },
        ipHash: metadata.ipHash,
      });
    });
  }

  private normalizeFilters(definition: ReportDefinition, input: ReportQueryDto): ReportFilters {
    const today = isoDate(new Date());
    const from = input.from ?? `${today.slice(0, 4)}-01-01`;
    const filters = reportFiltersSchema.parse({
      ...input,
      from,
      to: input.to ?? today,
      basis: input.basis ?? definition.supportedBasis[0],
      currencyMode: input.currencyMode ?? definition.supportedCurrencyModes[0],
    });
    if (!filters.from || !filters.to) throw new BadRequestException('Report dates are required.');
    if (filters.from > filters.to) throw new BadRequestException('from must be on or before to.');
    if (!definition.supportedBasis.includes(filters.basis)) {
      throw new BadRequestException(`${definition.name} does not support ${filters.basis} basis.`);
    }
    if (!definition.supportedCurrencyModes.includes(filters.currencyMode)) {
      throw new BadRequestException(
        `${definition.name} does not support ${filters.currencyMode} currency mode.`,
      );
    }
    if (filters.projectId && !definition.supportsProject) {
      throw new BadRequestException(`${definition.name} does not support project filtering.`);
    }
    if (filters.tagId && !definition.supportsTag) {
      throw new BadRequestException(`${definition.name} does not support tag filtering.`);
    }
    if (Boolean(filters.comparisonFrom) !== Boolean(filters.comparisonTo)) {
      throw new BadRequestException('comparisonFrom and comparisonTo must be supplied together.');
    }
    if (
      filters.comparisonFrom &&
      filters.comparisonTo &&
      filters.comparisonFrom > filters.comparisonTo
    ) {
      throw new BadRequestException('comparisonFrom must be on or before comparisonTo.');
    }
    return filters;
  }

  private async execute(
    organizationId: string,
    key: ReportKey,
    filters: ReportFilters,
  ): Promise<QueryResult> {
    if (key.startsWith('financial.')) return this.financial(organizationId, key, filters);
    if (key.startsWith('receivables.')) return this.receivables(organizationId, key, filters);
    if (key.startsWith('payables.')) return this.payables(organizationId, key, filters);
    if (key.startsWith('sales.')) return this.sales(organizationId, key, filters);
    if (key.startsWith('purchases.')) return this.purchases(organizationId, key, filters);
    if (key.startsWith('tax.')) return this.tax(organizationId, key, filters);
    if (key.startsWith('inventory.')) return this.inventory(organizationId, key, filters);
    if (key.startsWith('projects.')) return this.projects(organizationId, key, filters);
    return this.audit(organizationId, key, filters);
  }

  private async financial(organizationId: string, key: ReportKey, filters: ReportFilters) {
    const dimensions = dimensionSql(filters);
    const period = periodSql(filters);
    const asOf = Prisma.sql`j.journal_date <= ${dateValue(filters.to)}::date`;

    if (key === 'financial.general-ledger') {
      return this.query(
        Prisma.sql`
          SELECT jl.id::text AS id, j.journal_date AS date, COALESCE(j.reference, 'Draft') AS reference,
                 a.code || ' ' || a.name AS account, COALESCE(jl.description, j.description) AS description,
                 jl.debit_minor AS "debitMinor", jl.credit_minor AS "creditMinor",
                 'Journal' AS source_type, j.id::text AS source_id, '/journals/' || j.id::text AS href
          FROM journal_lines jl
          JOIN journals j ON j.id = jl.journal_id AND j.organization_id = ${organizationId}::uuid
          JOIN ledger_accounts a ON a.id = jl.account_id AND a.organization_id = ${organizationId}::uuid
          WHERE jl.organization_id = ${organizationId}::uuid AND j.status = 'POSTED' AND ${period} ${dimensions}
          ORDER BY j.journal_date, COALESCE(j.reference, ''), jl.line_number`,
        filters,
      );
    }

    if (key === 'financial.journal-report') {
      return this.query(
        Prisma.sql`
          SELECT j.id::text AS id, j.journal_date AS date, COALESCE(j.reference, '—') AS reference,
                 j.description, COALESCE(j.source_type, 'MANUAL') AS "sourceType",
                 SUM(jl.debit_minor) AS "debitMinor", SUM(jl.credit_minor) AS "creditMinor",
                 'Journal' AS source_type, j.id::text AS source_id, '/journals/' || j.id::text AS href
          FROM journals j
          JOIN journal_lines jl ON jl.journal_id = j.id AND jl.organization_id = ${organizationId}::uuid
          WHERE j.organization_id = ${organizationId}::uuid AND j.status = 'POSTED' AND ${period} ${dimensions}
          GROUP BY j.id ORDER BY j.journal_date, COALESCE(j.reference, '')`,
        filters,
      );
    }

    if (key === 'financial.cash-flow') {
      return this.query(
        Prisma.sql`
          SELECT a.id::text AS id, a.code || ' ' || a.name AS activity,
                 SUM(jl.debit_minor - jl.credit_minor) AS "amountMinor",
                 'LedgerAccount' AS source_type, a.id::text AS source_id,
                 '/accounts/' || a.id::text || '/ledger' AS href
          FROM journal_lines jl
          JOIN journals j ON j.id = jl.journal_id AND j.organization_id = ${organizationId}::uuid
          JOIN ledger_accounts a ON a.id = jl.account_id AND a.organization_id = ${organizationId}::uuid
          WHERE jl.organization_id = ${organizationId}::uuid AND j.status = 'POSTED' AND ${period}
            AND (a.system_key = 'bank_default' OR EXISTS (
              SELECT 1 FROM financial_accounts fa
              WHERE fa.organization_id = ${organizationId}::uuid AND fa.gl_account_id = a.id
            ))
          GROUP BY a.id ORDER BY a.code`,
        filters,
      );
    }

    const types =
      key === 'financial.profit-loss'
        ? Prisma.sql`a.type IN ('REVENUE', 'EXPENSE', 'COST_OF_SALES', 'OTHER_INCOME', 'OTHER_EXPENSE')`
        : key === 'financial.balance-sheet'
          ? Prisma.sql`a.type IN ('ASSET', 'LIABILITY', 'EQUITY')`
          : Prisma.sql`TRUE`;
    const dateFilter = key === 'financial.profit-loss' ? period : asOf;
    const amount =
      key === 'financial.profit-loss' || key === 'financial.balance-sheet'
        ? Prisma.sql`CASE WHEN a.normal_balance = 'DEBIT' THEN SUM(jl.debit_minor - jl.credit_minor) ELSE SUM(jl.credit_minor - jl.debit_minor) END`
        : Prisma.sql`NULL`;
    return this.query(
      Prisma.sql`
        SELECT a.id::text AS id, a.code || ' ' || a.name AS account, a.type::text AS type,
               a.type::text AS section, SUM(jl.debit_minor) AS "debitMinor",
               SUM(jl.credit_minor) AS "creditMinor", ${amount} AS "amountMinor",
               'LedgerAccount' AS source_type, a.id::text AS source_id,
               '/accounts/' || a.id::text || '/ledger' AS href
        FROM journal_lines jl
        JOIN journals j ON j.id = jl.journal_id AND j.organization_id = ${organizationId}::uuid
        JOIN ledger_accounts a ON a.id = jl.account_id AND a.organization_id = ${organizationId}::uuid
        WHERE jl.organization_id = ${organizationId}::uuid AND j.status = 'POSTED'
          AND ${dateFilter} AND ${types} ${dimensions}
        GROUP BY a.id HAVING SUM(jl.debit_minor) <> 0 OR SUM(jl.credit_minor) <> 0
        ORDER BY a.type, a.code`,
      filters,
    );
  }

  private async receivables(organizationId: string, key: ReportKey, filters: ReportFilters) {
    const period = Prisma.sql`i.issue_date >= ${dateValue(filters.from)}::date AND i.issue_date <= ${dateValue(filters.to)}::date`;
    if (key === 'receivables.payments-received') {
      return this.query(
        Prisma.sql`
        SELECT p.id::text AS id, p.received_date AS date, COALESCE(p.payment_number, '—') AS document,
               c.display_name AS customer, p.currency, p.amount_minor AS "amountMinor",
               p.unapplied_minor AS "unappliedMinor", 'PaymentReceived' AS source_type,
               p.id::text AS source_id, '/payments' AS href
        FROM payments_received p JOIN contacts c ON c.id = p.contact_id AND c.organization_id = ${organizationId}::uuid
        WHERE p.organization_id = ${organizationId}::uuid AND p.received_date >= ${dateValue(filters.from)}::date
          AND p.received_date <= ${dateValue(filters.to)}::date ORDER BY p.received_date, p.payment_number`,
        filters,
      );
    }
    if (key === 'receivables.invoice-details') {
      return this.query(
        Prisma.sql`
        SELECT i.id::text AS id, i.issue_date AS date, COALESCE(i.invoice_number, '—') AS document,
               c.display_name AS customer, i.status::text, i.currency, i.total_minor AS "amountMinor",
               i.balance_minor AS "balanceMinor", 'Invoice' AS source_type, i.id::text AS source_id,
               '/invoices/' || i.id::text AS href
        FROM invoices i JOIN contacts c ON c.id = i.contact_id AND c.organization_id = ${organizationId}::uuid
        WHERE i.organization_id = ${organizationId}::uuid AND i.status <> 'DRAFT' AND ${period}
        ORDER BY i.issue_date, i.invoice_number`,
        filters,
      );
    }
    const open = Prisma.sql`i.status NOT IN ('DRAFT', 'VOID', 'PAID') AND i.issue_date <= ${dateValue(filters.to)}::date AND i.balance_minor <> 0`;
    if (key === 'receivables.customer-balances') {
      return this.query(
        Prisma.sql`
        SELECT c.id::text AS id, c.display_name AS customer, i.currency,
               SUM(i.balance_minor) AS "amountMinor", 'Contact' AS source_type, c.id::text AS source_id,
               '/customers/' || c.id::text AS href
        FROM invoices i JOIN contacts c ON c.id = i.contact_id AND c.organization_id = ${organizationId}::uuid
        WHERE i.organization_id = ${organizationId}::uuid AND ${open}
        GROUP BY c.id, i.currency ORDER BY c.display_name, i.currency`,
        filters,
      );
    }
    if (key === 'receivables.aging-summary') {
      return this.agingSummary('invoices', organizationId, filters);
    }
    return this.query(
      Prisma.sql`
      SELECT i.id::text AS id, c.display_name AS customer, COALESCE(i.invoice_number, '—') AS document,
             i.due_date AS "dueDate", GREATEST(0, ${dateValue(filters.to)}::date - i.due_date) AS "daysOutstanding",
             i.currency, i.balance_minor AS "amountMinor", 'Invoice' AS source_type, i.id::text AS source_id,
             '/invoices/' || i.id::text AS href
      FROM invoices i JOIN contacts c ON c.id = i.contact_id AND c.organization_id = ${organizationId}::uuid
      WHERE i.organization_id = ${organizationId}::uuid AND ${open}
      ORDER BY i.due_date, i.invoice_number`,
      filters,
    );
  }

  private async payables(organizationId: string, key: ReportKey, filters: ReportFilters) {
    if (key === 'payables.payments-made') {
      return this.query(
        Prisma.sql`
        SELECT p.id::text AS id, p.paid_date AS date, COALESCE(p.payment_number, '—') AS document,
               v.display_name AS vendor, p.currency, p.amount_minor AS "amountMinor",
               p.unapplied_minor AS "unappliedMinor", 'PaymentMade' AS source_type,
               p.id::text AS source_id, '/payments-made' AS href
        FROM payments_made p JOIN vendors v ON v.id = p.vendor_id AND v.organization_id = ${organizationId}::uuid
        WHERE p.organization_id = ${organizationId}::uuid AND p.paid_date >= ${dateValue(filters.from)}::date
          AND p.paid_date <= ${dateValue(filters.to)}::date ORDER BY p.paid_date, p.payment_number`,
        filters,
      );
    }
    const period = Prisma.sql`b.issue_date >= ${dateValue(filters.from)}::date AND b.issue_date <= ${dateValue(filters.to)}::date`;
    if (key === 'payables.bill-details') {
      return this.query(
        Prisma.sql`
        SELECT b.id::text AS id, b.issue_date AS date, COALESCE(b.bill_number, '—') AS document,
               v.display_name AS vendor, b.status::text, b.currency, b.total_minor AS "amountMinor",
               b.balance_minor AS "balanceMinor", 'Bill' AS source_type, b.id::text AS source_id,
               '/bills/' || b.id::text AS href
        FROM bills b JOIN vendors v ON v.id = b.vendor_id AND v.organization_id = ${organizationId}::uuid
        WHERE b.organization_id = ${organizationId}::uuid AND b.status <> 'DRAFT' AND ${period}
        ORDER BY b.issue_date, b.bill_number`,
        filters,
      );
    }
    const open = Prisma.sql`b.status NOT IN ('DRAFT', 'VOID', 'PAID') AND b.issue_date <= ${dateValue(filters.to)}::date AND b.balance_minor <> 0`;
    if (key === 'payables.vendor-balances') {
      return this.query(
        Prisma.sql`
        SELECT v.id::text AS id, v.display_name AS vendor, b.currency,
               SUM(b.balance_minor) AS "amountMinor", 'Vendor' AS source_type, v.id::text AS source_id,
               '/vendors/' || v.id::text AS href
        FROM bills b JOIN vendors v ON v.id = b.vendor_id AND v.organization_id = ${organizationId}::uuid
        WHERE b.organization_id = ${organizationId}::uuid AND ${open}
        GROUP BY v.id, b.currency ORDER BY v.display_name, b.currency`,
        filters,
      );
    }
    if (key === 'payables.aging-summary')
      return this.agingSummary('bills', organizationId, filters);
    return this.query(
      Prisma.sql`
      SELECT b.id::text AS id, v.display_name AS vendor, COALESCE(b.bill_number, '—') AS document,
             b.due_date AS "dueDate", GREATEST(0, ${dateValue(filters.to)}::date - b.due_date) AS "daysOutstanding",
             b.currency, b.balance_minor AS "amountMinor", 'Bill' AS source_type, b.id::text AS source_id,
             '/bills/' || b.id::text AS href
      FROM bills b JOIN vendors v ON v.id = b.vendor_id AND v.organization_id = ${organizationId}::uuid
      WHERE b.organization_id = ${organizationId}::uuid AND ${open}
      ORDER BY b.due_date, b.bill_number`,
      filters,
    );
  }

  private async agingSummary(
    table: 'invoices' | 'bills',
    organizationId: string,
    filters: ReportFilters,
  ) {
    const party = table === 'invoices' ? Prisma.sql`invoices` : Prisma.sql`bills`;
    return this.query(
      Prisma.sql`
      SELECT bucket AS id, bucket, currency, SUM(balance_minor) AS "amountMinor"
      FROM (
        SELECT currency, balance_minor,
          CASE WHEN due_date >= ${dateValue(filters.to)}::date THEN 'Current'
               WHEN ${dateValue(filters.to)}::date - due_date <= 30 THEN '1–30 days'
               WHEN ${dateValue(filters.to)}::date - due_date <= 60 THEN '31–60 days'
               WHEN ${dateValue(filters.to)}::date - due_date <= 90 THEN '61–90 days'
               ELSE '90+ days' END AS bucket
        FROM ${party}
        WHERE organization_id = ${organizationId}::uuid AND status NOT IN ('DRAFT', 'VOID', 'PAID')
          AND issue_date <= ${dateValue(filters.to)}::date AND balance_minor <> 0
      ) aged GROUP BY bucket, currency ORDER BY MIN(CASE bucket WHEN 'Current' THEN 0 WHEN '1–30 days' THEN 1 WHEN '31–60 days' THEN 2 WHEN '61–90 days' THEN 3 ELSE 4 END)`,
      filters,
    );
  }

  private async sales(organizationId: string, key: ReportKey, filters: ReportFilters) {
    const group =
      key === 'sales.by-customer'
        ? Prisma.sql`c.id, c.display_name, i.currency`
        : key === 'sales.by-item'
          ? Prisma.sql`COALESCE(it.id::text, il.description_snapshot), COALESCE(it.name, il.description_snapshot), i.currency`
          : key === 'sales.by-period'
            ? Prisma.sql`date_trunc('month', i.issue_date), i.currency`
            : Prisma.sql`COALESCE(jl.tag_id::text, 'untagged'), COALESCE(t.name, 'Untagged'), i.currency`;
    const selected =
      key === 'sales.by-customer'
        ? Prisma.sql`c.id::text AS id, c.display_name AS customer`
        : key === 'sales.by-item'
          ? Prisma.sql`COALESCE(it.id::text, il.description_snapshot) AS id, COALESCE(it.name, il.description_snapshot) AS item`
          : key === 'sales.by-period'
            ? Prisma.sql`to_char(date_trunc('month', i.issue_date), 'YYYY-MM') AS id, date_trunc('month', i.issue_date)::date AS period`
            : Prisma.sql`COALESCE(jl.tag_id::text, 'untagged') AS id, COALESCE(t.name, 'Untagged') AS tag`;
    const tagJoins =
      key === 'sales.by-tag'
        ? Prisma.sql`LEFT JOIN journals j ON j.id = i.journal_id AND j.organization_id = ${organizationId}::uuid LEFT JOIN journal_lines jl ON jl.journal_id = j.id AND jl.organization_id = ${organizationId}::uuid AND jl.account_id = il.revenue_account_id LEFT JOIN tags t ON t.id = jl.tag_id AND t.organization_id = ${organizationId}::uuid`
        : Prisma.empty;
    const tagFilter =
      key === 'sales.by-tag' && filters.tagId
        ? Prisma.sql`AND jl.tag_id = ${filters.tagId}::uuid`
        : Prisma.empty;
    return this.query(
      Prisma.sql`
      SELECT ${selected}, i.currency, SUM(il.line_total_minor) AS "amountMinor"
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id AND i.organization_id = ${organizationId}::uuid
      JOIN contacts c ON c.id = i.contact_id AND c.organization_id = ${organizationId}::uuid
      LEFT JOIN items it ON it.id = il.item_id AND it.organization_id = ${organizationId}::uuid
      ${tagJoins}
      WHERE il.organization_id = ${organizationId}::uuid AND i.status NOT IN ('DRAFT', 'VOID')
        AND i.issue_date >= ${dateValue(filters.from)}::date AND i.issue_date <= ${dateValue(filters.to)}::date ${tagFilter}
      GROUP BY ${group} ORDER BY 2`,
      filters,
    );
  }

  private async purchases(organizationId: string, key: ReportKey, filters: ReportFilters) {
    const rows = await this.prisma.$queryRaw<DbRow[]>(Prisma.sql`
      WITH source AS (
        SELECT b.id, b.issue_date AS date, b.vendor_id, bl.account_id AS category_id,
               b.currency, bl.line_total_minor AS amount_minor
        FROM bill_lines bl JOIN bills b ON b.id = bl.bill_id AND b.organization_id = ${organizationId}::uuid
        WHERE bl.organization_id = ${organizationId}::uuid AND b.status NOT IN ('DRAFT', 'VOID')
          AND b.issue_date >= ${dateValue(filters.from)}::date AND b.issue_date <= ${dateValue(filters.to)}::date
        UNION ALL
        SELECT e.id, e.expense_date, e.payee_vendor_id, ec.account_id, e.currency, e.amount_minor
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id AND ec.organization_id = ${organizationId}::uuid
        WHERE e.organization_id = ${organizationId}::uuid AND e.status = 'POSTED'
          AND e.expense_date >= ${dateValue(filters.from)}::date AND e.expense_date <= ${dateValue(filters.to)}::date
      )
      SELECT CASE WHEN ${key} = 'purchases.by-vendor' THEN COALESCE(v.id::text, 'unassigned')
                  WHEN ${key} = 'purchases.by-category' THEN COALESCE(a.id::text, 'unassigned')
                  ELSE to_char(date_trunc('month', source.date), 'YYYY-MM') END AS id,
             CASE WHEN ${key} = 'purchases.by-vendor' THEN COALESCE(v.display_name, 'Unassigned') END AS vendor,
             CASE WHEN ${key} = 'purchases.by-category' THEN COALESCE(a.name, 'Unassigned') END AS category,
             CASE WHEN ${key} = 'purchases.by-period' THEN date_trunc('month', source.date)::date END AS period,
             source.currency, SUM(source.amount_minor) AS "amountMinor"
      FROM source LEFT JOIN vendors v ON v.id = source.vendor_id AND v.organization_id = ${organizationId}::uuid
      LEFT JOIN ledger_accounts a ON a.id = source.category_id AND a.organization_id = ${organizationId}::uuid
      GROUP BY 1, 2, 3, 4, source.currency ORDER BY 2 NULLS LAST, 3 NULLS LAST, 4 NULLS LAST`);
    return this.result(rows, filters);
  }

  private async tax(organizationId: string, key: ReportKey, filters: ReportFilters) {
    const period = periodSql(filters);
    const detail = key === 'tax.detail';
    const group =
      key === 'tax.taxable-exempt-bases'
        ? Prisma.sql`COALESCE(jl.tax_treatment_snapshot::text, 'EXEMPT')`
        : key === 'tax.liability-recoverable'
          ? Prisma.sql`CASE WHEN jl.tax_recoverable_snapshot THEN 'Recoverable' ELSE 'Liability' END`
          : Prisma.sql`COALESCE(jl.tax_code_snapshot, 'Uncoded')`;
    const selected =
      key === 'tax.taxable-exempt-bases'
        ? Prisma.sql`${group} AS treatment`
        : key === 'tax.liability-recoverable'
          ? Prisma.sql`${group} AS side`
          : Prisma.sql`${group} AS "taxCode"`;
    if (detail) {
      return this.query(
        Prisma.sql`
        SELECT jl.id::text AS id, j.journal_date AS date, COALESCE(j.reference, '—') AS reference,
               COALESCE(jl.tax_code_snapshot, 'Uncoded') AS "taxCode",
               COALESCE(jl.taxable_amount_minor, 0) AS "taxableMinor",
               COALESCE(jl.tax_amount_minor, 0) AS "taxMinor", 'Journal' AS source_type,
               j.id::text AS source_id, '/journals/' || j.id::text AS href
        FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id AND j.organization_id = ${organizationId}::uuid
        WHERE jl.organization_id = ${organizationId}::uuid AND j.status = 'POSTED' AND ${period}
          AND (jl.tax_code_snapshot IS NOT NULL OR jl.tax_amount_minor IS NOT NULL)
        ORDER BY j.journal_date, j.reference, jl.line_number`,
        filters,
      );
    }
    return this.query(
      Prisma.sql`
      SELECT ${group} AS id, ${selected}, SUM(COALESCE(jl.taxable_amount_minor, 0)) AS "taxableMinor",
             SUM(COALESCE(jl.tax_amount_minor, 0)) AS "taxMinor"
      FROM journal_lines jl JOIN journals j ON j.id = jl.journal_id AND j.organization_id = ${organizationId}::uuid
      WHERE jl.organization_id = ${organizationId}::uuid AND j.status = 'POSTED' AND ${period}
        AND (jl.tax_code_snapshot IS NOT NULL OR jl.tax_amount_minor IS NOT NULL)
      GROUP BY ${group} ORDER BY 1`,
      filters,
    );
  }

  private async inventory(organizationId: string, key: ReportKey, filters: ReportFilters) {
    if (key === 'inventory.valuation') {
      return this.query(
        Prisma.sql`
        SELECT (vl.item_id::text || ':' || vl.warehouse_id::text) AS id, it.name AS item, w.name AS warehouse,
               SUM(vl.quantity_remaining)::text AS quantity, SUM(vl.cost_remaining_minor) AS "amountMinor",
               'Item' AS source_type, it.id::text AS source_id, '/catalog/items' AS href
        FROM valuation_layers vl JOIN items it ON it.id = vl.item_id AND it.organization_id = ${organizationId}::uuid
        JOIN warehouses w ON w.id = vl.warehouse_id AND w.organization_id = ${organizationId}::uuid
        WHERE vl.organization_id = ${organizationId}::uuid AND vl.layer_date <= ${dateValue(filters.to)}::date
        GROUP BY vl.item_id, vl.warehouse_id, it.id, w.id ORDER BY it.name, w.name`,
        filters,
      );
    }
    if (key === 'inventory.movements') {
      return this.query(
        Prisma.sql`
        SELECT sm.id::text AS id, sm.movement_date AS date, it.name AS item, w.name AS warehouse,
               sm.direction::text AS direction, sm.quantity::text AS quantity, sm.total_cost_minor AS "amountMinor",
               'StockMovement' AS source_type, sm.id::text AS source_id, '/stock-movements' AS href
        FROM stock_movements sm JOIN items it ON it.id = sm.item_id AND it.organization_id = ${organizationId}::uuid
        JOIN warehouses w ON w.id = sm.warehouse_id AND w.organization_id = ${organizationId}::uuid
        WHERE sm.organization_id = ${organizationId}::uuid AND sm.movement_date >= ${dateValue(filters.from)}::date
          AND sm.movement_date <= ${dateValue(filters.to)}::date ORDER BY sm.movement_date, sm.created_at`,
        filters,
      );
    }
    if (key === 'inventory.adjustments') {
      return this.query(
        Prisma.sql`
        SELECT ia.id::text AS id, ia.adjustment_date AS date, it.name AS item, w.name AS warehouse,
               ia.status::text, ia.quantity_delta::text AS quantity, ia.value_delta_minor AS "amountMinor",
               'InventoryAdjustment' AS source_type, ia.id::text AS source_id, '/inventory-adjustments' AS href
        FROM inventory_adjustments ia JOIN items it ON it.id = ia.item_id AND it.organization_id = ${organizationId}::uuid
        JOIN warehouses w ON w.id = ia.warehouse_id AND w.organization_id = ${organizationId}::uuid
        WHERE ia.organization_id = ${organizationId}::uuid AND ia.adjustment_date >= ${dateValue(filters.from)}::date
          AND ia.adjustment_date <= ${dateValue(filters.to)}::date ORDER BY ia.adjustment_date, ia.created_at`,
        filters,
      );
    }
    const inventoryRows = Prisma.sql`
      SELECT (sm.item_id::text || ':' || sm.warehouse_id::text) AS id, it.id::text AS item_id,
             it.name AS item, w.name AS warehouse,
             SUM(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END)::text AS quantity,
             COALESCE(it.reorder_threshold, 0)::text AS "reorderPoint",
             GREATEST(COALESCE(it.reorder_quantity, 0), COALESCE(it.reorder_threshold, 0) - SUM(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END))::text AS suggested,
             'Item' AS source_type, it.id::text AS source_id, '/catalog/items' AS href
      FROM stock_movements sm JOIN items it ON it.id = sm.item_id AND it.organization_id = ${organizationId}::uuid
      JOIN warehouses w ON w.id = sm.warehouse_id AND w.organization_id = ${organizationId}::uuid
      WHERE sm.organization_id = ${organizationId}::uuid AND sm.movement_date <= ${dateValue(filters.to)}::date
      GROUP BY sm.item_id, sm.warehouse_id, it.id, w.id`;
    return this.query(
      key === 'inventory.reorder'
        ? Prisma.sql`SELECT * FROM (${inventoryRows}) stock WHERE quantity::numeric <= "reorderPoint"::numeric ORDER BY item, warehouse`
        : Prisma.sql`${inventoryRows} ORDER BY item, warehouse`,
      filters,
    );
  }

  private async projects(organizationId: string, key: ReportKey, filters: ReportFilters) {
    const projectFilter = filters.projectId
      ? Prisma.sql`AND p.id = ${filters.projectId}::uuid`
      : Prisma.empty;
    if (key === 'projects.time') {
      return this.query(
        Prisma.sql`
        SELECT p.id::text AS id, p.name AS project, SUM(te.hours)::text AS hours,
               SUM(ROUND(te.hours * COALESCE(te.cost_rate_minor, 0)))::bigint AS "costMinor",
               'Project' AS source_type, p.id::text AS source_id, '/projects/' || p.id::text AS href
        FROM time_entries te JOIN projects p ON p.id = te.project_id AND p.organization_id = ${organizationId}::uuid
        WHERE te.organization_id = ${organizationId}::uuid AND te.status IN ('APPROVED', 'INVOICED')
          AND te.entry_date >= ${dateValue(filters.from)}::date AND te.entry_date <= ${dateValue(filters.to)}::date ${projectFilter}
        GROUP BY p.id ORDER BY p.name`,
        filters,
      );
    }
    if (key === 'projects.unbilled') {
      return this.query(
        Prisma.sql`
        SELECT p.id::text AS id, p.name AS project,
          COALESCE((SELECT SUM(ROUND(te.hours * COALESCE(te.rate_minor, p.default_rate_minor, 0)))::bigint
                    FROM time_entries te WHERE te.organization_id = ${organizationId}::uuid AND te.project_id = p.id
                      AND te.status = 'APPROVED' AND te.billable AND te.invoice_line_id IS NULL
                      AND te.entry_date <= ${dateValue(filters.to)}::date), 0) AS "timeMinor",
          COALESCE((SELECT SUM(ROUND(e.total_minor * (1 + COALESCE(pe.markup_percent, 0) / 100)))::bigint
                    FROM project_expenses pe JOIN expenses e ON e.id = pe.expense_id AND e.organization_id = ${organizationId}::uuid
                    WHERE pe.organization_id = ${organizationId}::uuid AND pe.project_id = p.id
                      AND pe.billable AND pe.invoice_line_id IS NULL AND e.expense_date <= ${dateValue(filters.to)}::date), 0) AS "expenseMinor",
          'Project' AS source_type, p.id::text AS source_id, '/projects/' || p.id::text AS href
        FROM projects p WHERE p.organization_id = ${organizationId}::uuid ${projectFilter} ORDER BY p.name`,
        filters,
      );
    }
    return this.query(
      Prisma.sql`
      SELECT p.id::text AS id, p.name AS project,
             SUM(CASE WHEN a.type IN ('REVENUE', 'OTHER_INCOME') THEN jl.credit_minor - jl.debit_minor ELSE 0 END) AS "revenueMinor",
             SUM(CASE WHEN a.type IN ('EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE') THEN jl.debit_minor - jl.credit_minor ELSE 0 END) AS "costMinor",
             SUM(CASE WHEN a.type IN ('REVENUE', 'OTHER_INCOME') THEN jl.credit_minor - jl.debit_minor WHEN a.type IN ('EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE') THEN jl.credit_minor - jl.debit_minor ELSE 0 END) AS "marginMinor",
             CASE WHEN SUM(CASE WHEN a.type IN ('REVENUE', 'OTHER_INCOME') THEN jl.credit_minor - jl.debit_minor ELSE 0 END) = 0 THEN 0
                  ELSE ROUND(10000.0 * SUM(CASE WHEN a.type IN ('REVENUE', 'OTHER_INCOME') THEN jl.credit_minor - jl.debit_minor WHEN a.type IN ('EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE') THEN jl.credit_minor - jl.debit_minor ELSE 0 END)
                    / SUM(CASE WHEN a.type IN ('REVENUE', 'OTHER_INCOME') THEN jl.credit_minor - jl.debit_minor ELSE 0 END)) / 100 END AS "marginPercent",
             'Project' AS source_type, p.id::text AS source_id, '/projects/' || p.id::text AS href
      FROM projects p JOIN journal_lines jl ON jl.project_id = p.id AND jl.organization_id = ${organizationId}::uuid
      JOIN journals j ON j.id = jl.journal_id AND j.organization_id = ${organizationId}::uuid
      JOIN ledger_accounts a ON a.id = jl.account_id AND a.organization_id = ${organizationId}::uuid
      WHERE p.organization_id = ${organizationId}::uuid AND j.status = 'POSTED' AND ${periodSql(filters)} ${projectFilter}
        AND a.type IN ('REVENUE', 'EXPENSE', 'COST_OF_SALES', 'OTHER_INCOME', 'OTHER_EXPENSE') GROUP BY p.id ORDER BY p.name`,
      filters,
    );
  }

  private async audit(organizationId: string, key: ReportKey, filters: ReportFilters) {
    const extra =
      key === 'audit.approvals'
        ? Prisma.sql`AND (ae.event_key ILIKE '%approv%' OR ae.event_key ILIKE '%reject%')`
        : key === 'audit.void-reversal-history'
          ? Prisma.sql`AND (ae.event_key ILIKE '%void%' OR ae.event_key ILIKE '%revers%')`
          : key === 'audit.transaction-history'
            ? Prisma.sql`AND ae.entity_type IN ('Journal', 'Invoice', 'Bill', 'Expense', 'PaymentReceived', 'PaymentMade', 'Transfer', 'InventoryAdjustment')`
            : Prisma.empty;
    return this.query(
      Prisma.sql`
      SELECT ae.id::text AS id, ae.occurred_at::date AS date, COALESCE(u.display_name, 'System') AS "user",
             ae.event_key AS event, ae.entity_type AS entity, ae.action::text AS action,
             ae.entity_type AS source_type, COALESCE(ae.entity_id, ae.id::text) AS source_id,
             CASE WHEN ae.entity_type = 'Journal' AND ae.entity_id IS NOT NULL THEN '/journals/' || ae.entity_id ELSE '/settings/audit-log' END AS href
      FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_user_id
      WHERE ae.organization_id = ${organizationId}::uuid AND ae.occurred_at >= ${dateTimeStart(filters.from)}
        AND ae.occurred_at < ${dateTimeAfter(filters.to)} ${extra}
      ORDER BY ae.occurred_at DESC, ae.id DESC`,
      filters,
    );
  }

  private async query(sql: Prisma.Sql, filters: ReportFilters): Promise<QueryResult> {
    const rows = await this.prisma.$queryRaw<DbRow[]>(sql);
    return this.result(rows, filters);
  }

  private result(rawRows: DbRow[], filters: ReportFilters): QueryResult {
    const totalRows = rawRows.length;
    const start = (filters.page - 1) * filters.pageSize;
    const pageRows = rawRows.slice(start, start + filters.pageSize).map(toReportRow);
    const currencies = new Set(
      rawRows
        .map((row) => row.currency)
        .filter(Boolean)
        .map((value) => serializeCell(value))
        .map((value) => String(value)),
    );
    const totals: Record<string, string | number | boolean | null> = {};
    if (currencies.size <= 1) {
      for (const row of rawRows) {
        for (const [key, value] of Object.entries(row)) {
          if (!key.endsWith('Minor') || value === null || value === undefined) continue;
          totals[key] = (
            BigInt(integerText(totals[key] ?? '0')) + BigInt(integerText(value))
          ).toString();
        }
      }
    } else {
      totals.mixedCurrencies = true;
    }
    return { rows: pageRows, totals, totalRows };
  }
}

function periodSql(filters: ReportFilters): Prisma.Sql {
  return Prisma.sql`j.journal_date >= ${dateValue(filters.from)}::date AND j.journal_date <= ${dateValue(filters.to)}::date`;
}

function dimensionSql(filters: ReportFilters): Prisma.Sql {
  const project = filters.projectId
    ? Prisma.sql`AND jl.project_id = ${filters.projectId}::uuid`
    : Prisma.empty;
  const tag = filters.tagId ? Prisma.sql`AND jl.tag_id = ${filters.tagId}::uuid` : Prisma.empty;
  return Prisma.sql`${project} ${tag}`;
}

function dateValue(value: string | undefined): string {
  if (!value) throw new BadRequestException('A report date is required.');
  return value;
}

function dateTimeStart(value: string | undefined): Date {
  return new Date(`${dateValue(value)}T00:00:00.000Z`);
}

function dateTimeAfter(value: string | undefined): Date {
  const result = dateTimeStart(value);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toReportRow(row: DbRow): ReportRow {
  const cells: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(row)) {
    if (['id', 'source_type', 'source_id', 'href'].includes(key)) continue;
    cells[key] = serializeCell(value);
  }
  return {
    id: String(row.id),
    cells,
    source:
      row.source_type && row.source_id && row.href
        ? { entityType: row.source_type, entityId: row.source_id, href: row.href }
        : null,
  };
}

function serializeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return JSON.stringify(value);
}

function integerText(value: unknown): string {
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  throw new Error('A report money column returned a non-numeric value.');
}

function serializeSavedReport(report: {
  id: string;
  name: string;
  reportKey: string;
  filters: Prisma.JsonValue;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: report.id,
    name: report.name,
    reportKey: report.reportKey as ReportKey,
    filters: report.filters as Partial<ReportFilters>,
    createdByUserId: report.createdByUserId,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function savedAuditShape(report: { name: string; reportKey: string; filters: Prisma.JsonValue }) {
  return {
    name: report.name,
    reportKey: report.reportKey,
    filters: report.filters,
  } as Prisma.InputJsonObject;
}
