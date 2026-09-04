import { BadRequestException, Injectable } from '@nestjs/common';
import type { ReportColumn, ReportKey, ReportRow } from '@retailbooks/contracts';
import ExcelJS from 'exceljs';
import type { Response } from 'express';

import { DocumentRenderingService } from '../sales/document-rendering.service.js';
import type { ReportExportQueryDto } from './reporting.dto.js';
import { ReportingService } from './reporting.service.js';

const EXPORT_PAGE_SIZE = 500;
const PDF_ROW_LIMIT = 2_000;

@Injectable()
export class ReportExportService {
  constructor(
    private readonly reports: ReportingService,
    private readonly rendering: DocumentRenderingService,
  ) {}

  async export(
    response: Response,
    organizationId: string,
    key: ReportKey,
    query: ReportExportQueryDto,
  ): Promise<void> {
    if (query.format === 'csv') return this.csv(response, organizationId, key, query);
    if (query.format === 'xlsx') return this.xlsx(response, organizationId, key, query);
    return this.pdf(response, organizationId, key, query);
  }

  private async csv(
    response: Response,
    organizationId: string,
    key: ReportKey,
    query: ReportExportQueryDto,
  ) {
    const first = await this.reports.run(organizationId, key, {
      ...query,
      page: 1,
      pageSize: EXPORT_PAGE_SIZE,
    });
    setDownloadHeaders(response, key, 'csv', 'text/csv; charset=utf-8');
    response.write('\uFEFF');
    response.write(
      `${first.definition.columns.map((column) => csvCell(column.label)).join(',')}\r\n`,
    );
    let page = 1;
    let current = first;
    while (true) {
      for (const row of current.rows)
        response.write(`${csvRow(row, first.definition.columns)}\r\n`);
      if (page * EXPORT_PAGE_SIZE >= current.pagination.totalRows) break;
      page += 1;
      current = await this.reports.run(organizationId, key, {
        ...query,
        page,
        pageSize: EXPORT_PAGE_SIZE,
      });
    }
    response.end();
  }

  private async xlsx(
    response: Response,
    organizationId: string,
    key: ReportKey,
    query: ReportExportQueryDto,
  ) {
    const first = await this.reports.run(organizationId, key, {
      ...query,
      page: 1,
      pageSize: EXPORT_PAGE_SIZE,
    });
    setDownloadHeaders(
      response,
      key,
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response, useStyles: true });
    const sheet = workbook.addWorksheet(first.definition.name.slice(0, 31));
    sheet.columns = first.definition.columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: Math.max(14, Math.min(36, column.label.length + 8)),
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).commit();
    let page = 1;
    let current = first;
    while (true) {
      for (const row of current.rows) {
        sheet
          .addRow(
            Object.fromEntries(
              first.definition.columns.map((column) => [column.key, row.cells[column.key] ?? '']),
            ),
          )
          .commit();
      }
      if (page * EXPORT_PAGE_SIZE >= current.pagination.totalRows) break;
      page += 1;
      current = await this.reports.run(organizationId, key, {
        ...query,
        page,
        pageSize: EXPORT_PAGE_SIZE,
      });
    }
    sheet.commit();
    await workbook.commit();
  }

  private async pdf(
    response: Response,
    organizationId: string,
    key: ReportKey,
    query: ReportExportQueryDto,
  ) {
    const result = await this.reports.run(organizationId, key, {
      ...query,
      page: 1,
      pageSize: 500,
    });
    if (result.pagination.totalRows > PDF_ROW_LIMIT) {
      throw new BadRequestException(
        `PDF export is limited to ${PDF_ROW_LIMIT} rows until the Phase 10 report worker is available. Use streaming CSV or XLSX for this result.`,
      );
    }
    const rows = [...result.rows];
    for (let page = 2; rows.length < result.pagination.totalRows; page += 1) {
      const next = await this.reports.run(organizationId, key, { ...query, page, pageSize: 500 });
      rows.push(...next.rows);
    }
    const pdf = await this.rendering.renderPdf(
      reportHtml(result.definition.name, result.definition.columns, rows),
    );
    setDownloadHeaders(response, key, 'pdf', 'application/pdf');
    response.end(pdf);
  }
}

function setDownloadHeaders(
  response: Response,
  key: ReportKey,
  extension: string,
  contentType: string,
) {
  response.setHeader('Content-Type', contentType);
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${key}-${new Date().toISOString().slice(0, 10)}.${extension}"`,
  );
}

function csvRow(row: ReportRow, columns: readonly ReportColumn[]): string {
  return columns.map((column) => csvCell(row.cells[column.key])).join(',');
}

function csvCell(value: unknown): string {
  const text = primitiveText(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function primitiveText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value.toString();
  }
  return JSON.stringify(value);
}

function reportHtml(
  title: string,
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
): string {
  const header = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((column) => `<td>${escapeHtml(String(row.cells[column.key] ?? ''))}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;color:#17211b;padding:24px}h1{font-size:20px;margin:0 0 16px}
    table{border-collapse:collapse;width:100%;font-size:9px}th,td{border-bottom:1px solid #dfe5e1;padding:5px;text-align:left}
    th{background:#eef3ef;font-weight:700}tr{break-inside:avoid}
  </style></head><body><h1>${escapeHtml(title)}</h1><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
