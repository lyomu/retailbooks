import { Injectable } from '@nestjs/common';
import type { ReportColumn, ReportKey, ReportRow } from '@retailbooks/contracts';
import ExcelJS from 'exceljs';

import { DocumentRenderingService } from '../sales/document-rendering.service.js';
import type { ReportQueryDto } from './reporting.dto.js';
import { ReportingService } from './reporting.service.js';

const PAGE_SIZE = 500;

export type ReportArtifact = {
  buffer: Buffer;
  contentType: string;
  extension: 'csv' | 'xlsx' | 'pdf';
};

/** Transport-neutral report generation shared by worker delivery and future async downloads. */
@Injectable()
export class ReportArtifactService {
  constructor(
    private readonly reports: ReportingService,
    private readonly rendering: DocumentRenderingService,
  ) {}

  async generate(
    organizationId: string,
    key: ReportKey,
    filters: Partial<ReportQueryDto>,
    format: 'csv' | 'xlsx' | 'pdf',
  ): Promise<ReportArtifact> {
    const first = await this.reports.run(organizationId, key, {
      ...filters,
      page: 1,
      pageSize: PAGE_SIZE,
    });
    const rows = await this.loadRows(organizationId, key, filters, first);
    if (format === 'csv') {
      return {
        buffer: Buffer.from(
          `\uFEFF${first.definition.columns.map((column) => cell(column.label)).join(',')}\r\n${rows.map((row) => (row.cells ? first.definition.columns.map((column) => cell(row.cells[column.key])).join(',') : '')).join('\r\n')}\r\n`,
        ),
        contentType: 'text/csv; charset=utf-8',
        extension: 'csv',
      };
    }
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(first.definition.name.slice(0, 31));
      sheet.columns = first.definition.columns.map((column) => ({
        header: column.label,
        key: column.key,
        width: Math.max(14, Math.min(36, column.label.length + 8)),
      }));
      for (const row of rows)
        sheet.addRow(
          Object.fromEntries(
            first.definition.columns.map((column) => [column.key, row.cells[column.key] ?? '']),
          ),
        );
      const output = await workbook.xlsx.writeBuffer();
      return {
        buffer: Buffer.from(output),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
      };
    }
    const buffer = await this.rendering.renderPdf(
      reportHtml(first.definition.name, first.definition.columns, rows),
    );
    return { buffer, contentType: 'application/pdf', extension: 'pdf' };
  }

  private async loadRows(
    organizationId: string,
    key: ReportKey,
    filters: Partial<ReportQueryDto>,
    first: Awaited<ReturnType<ReportingService['run']>>,
  ) {
    const rows = [...first.rows];
    for (let page = 2; rows.length < first.pagination.totalRows; page += 1) {
      const next = await this.reports.run(organizationId, key, {
        ...filters,
        page,
        pageSize: PAGE_SIZE,
      });
      rows.push(...next.rows);
    }
    return rows;
  }
}

function cell(value: unknown) {
  const text = stringifyCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function reportHtml(title: string, columns: readonly ReportColumn[], rows: readonly ReportRow[]) {
  const escape = (value: unknown) =>
    stringifyCell(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:24px;color:#17211b}table{border-collapse:collapse;width:100%;font-size:9px}th,td{border-bottom:1px solid #dfe5e1;padding:5px;text-align:left}th{background:#eef3ef}</style></head><body><h1>${escape(title)}</h1><table><thead><tr>${columns.map((column) => `<th>${escape(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escape(row.cells[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
