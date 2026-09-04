'use client';

import type {
  ReportColumn,
  ReportDefinition,
  ReportDefinitionsResponse,
  ReportFilters,
  ReportKey,
  ReportResult,
  SavedReport,
  SavedReportResponse,
  SavedReportsResponse,
} from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
} from '@retailbooks/ui';
import { Download, FileBarChart, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiDownloadUrl, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type ReportData = ReportResult['data'];

export function ReportLibraryPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'reports.view');
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId || !canView) return;
    apiRequest<ReportDefinitionsResponse>(`/organizations/${organizationId}/reports/definitions`)
      .then((response) => {
        setDefinitions(response.data);
        setError(null);
      })
      .catch((caught: unknown) =>
        setError(message(caught, 'The report library could not be loaded.')),
      );
  }, [canView, organizationId]);

  const groups = useMemo(
    () => Map.groupBy(definitions, (definition) => definition.family),
    [definitions],
  );

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for report access to open the report library." />;
  }

  return (
    <>
      <PageHeader
        title="Report library"
        description="Financial and operational reports with explicit sources, reconciliation rules, and drill-down."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports/saved">Saved reports</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} />
        {definitions.length === 0 && !error ? <Skeleton /> : null}
        {[...groups.entries()].map(([family, reports]) => (
          <Card key={family} className="rb-report-family">
            <div className="rb-report-family__heading">
              <FileBarChart aria-hidden="true" />
              <h2>{family}</h2>
              <Badge>{reports.length} reports</Badge>
            </div>
            <div className="rb-report-library-grid">
              {reports.map((report) => (
                <Link
                  className="rb-report-library-card"
                  href={`/reports/${report.key}`}
                  key={report.key}
                >
                  <strong>{report.name}</strong>
                  <span>{report.description}</span>
                </Link>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

export function ReportRunnerPage({
  reportKey,
  initialFilters,
}: {
  reportKey: string;
  initialFilters?: Partial<ReportFilters>;
}) {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'reports.view');
  const canManage = hasPermission(organization, 'reports.manage');
  const [definition, setDefinition] = useState<ReportDefinition | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [filters, setFilters] = useState<Partial<ReportFilters>>({
    from: yearStart(),
    to: today(),
    ...initialFilters,
  });
  const [saveName, setSaveName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !canView) return;
    setLoading(true);
    try {
      const query = filterParams(filters);
      const response = await apiRequest<ReportResult>(
        `/organizations/${organizationId}/reports/${encodeURIComponent(reportKey)}?${query}`,
      );
      setReport(response.data);
      setDefinition(response.data.definition);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'The report could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [canView, filters, organizationId, reportKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!organizationId || !definition || (!definition.supportsProject && !definition.supportsTag))
      return;
    void apiRequest<{
      data: {
        projects: Array<{ id: string; name: string }>;
        tags: Array<{ id: string; name: string }>;
      };
    }>(`/organizations/${organizationId}/reports/filter-options`).then((response) => {
      setProjects(response.data.projects);
      setTags(response.data.tags);
    });
  }, [definition, organizationId]);

  async function saveReport() {
    if (!organizationId || !definition || !saveName.trim()) return;
    try {
      await apiRequest<SavedReportResponse>(`/organizations/${organizationId}/reports/saved`, {
        method: 'POST',
        body: JSON.stringify({ name: saveName.trim(), reportKey: definition.key, filters }),
      });
      setSaveName('');
      setNotice('Report saved.');
      setError(null);
    } catch (caught) {
      setError(message(caught, 'The report could not be saved.'));
    }
  }

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for report access to run this report." />;
  }

  const currency = report?.baseCurrency ?? organization?.baseCurrency ?? 'KES';
  return (
    <>
      <PageHeader
        title={definition?.name ?? 'Report'}
        description={definition?.description ?? 'Loading report definition…'}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports">Report library</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        <Card className="rb-report-filters">
          <Field label="From">
            <Input
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={filters.to ?? ''}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </Field>
          {definition && definition.supportedBasis.length > 1 ? (
            <Field label="Basis">
              <Select
                value={filters.basis ?? definition.supportedBasis[0]}
                onChange={(event) =>
                  setFilters({ ...filters, basis: event.target.value as ReportFilters['basis'] })
                }
              >
                {definition.supportedBasis.map((basis) => (
                  <option key={basis}>{basis}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          {definition?.supportsProject ? (
            <Field label="Project">
              <Select
                value={filters.projectId ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, projectId: event.target.value || undefined })
                }
              >
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {definition?.supportsTag ? (
            <Field label="Tag">
              <Select
                value={filters.tagId ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, tagId: event.target.value || undefined })
                }
              >
                <option value="">All tags</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Compare from">
            <Input
              type="date"
              value={filters.comparisonFrom ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, comparisonFrom: event.target.value || undefined })
              }
            />
          </Field>
          <Field label="Compare to">
            <Input
              type="date"
              value={filters.comparisonTo ?? ''}
              onChange={(event) =>
                setFilters({ ...filters, comparisonTo: event.target.value || undefined })
              }
            />
          </Field>
          <Button onClick={() => void load()} disabled={loading}>
            Run report
          </Button>
        </Card>

        {definition ? (
          <Card className="rb-report-actions">
            <div className="rb-report-export-actions">
              {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
                <Button key={format} variant="outline" size="sm" asChild>
                  <a href={exportHref(organizationId, definition.key, filters, format)}>
                    <Download aria-hidden="true" /> {format.toUpperCase()}
                  </a>
                </Button>
              ))}
            </div>
            {canManage ? (
              <div className="rb-report-save-actions">
                <Input
                  aria-label="Saved report name"
                  placeholder="Saved report name"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                />
                <Button size="sm" onClick={() => void saveReport()} disabled={!saveName.trim()}>
                  <Save aria-hidden="true" /> Save
                </Button>
              </div>
            ) : null}
          </Card>
        ) : null}

        {loading && !report ? <Skeleton /> : null}
        {report ? <ReportTable report={report} currency={currency} /> : null}
        {definition ? (
          <Card className="rb-report-provenance">
            <div>
              <strong>Source of truth</strong>
              <p>{definition.sourceOfTruth}</p>
            </div>
            <div>
              <strong>Reconciliation</strong>
              <p>{definition.reconciliation}</p>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

export function SavedReportsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'reports.view');
  const canManage = hasPermission(organization, 'reports.manage');
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !canView) return;
    try {
      const response = await apiRequest<SavedReportsResponse>(
        `/organizations/${organizationId}/reports/saved`,
      );
      setReports(response.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Saved reports could not be loaded.'));
    }
  }, [canView, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    if (!organizationId) return;
    try {
      await apiRequest(`/organizations/${organizationId}/reports/saved/${id}`, {
        method: 'DELETE',
      });
      await load();
    } catch (caught) {
      setError(message(caught, 'The saved report could not be deleted.'));
    }
  }

  if (!workspace.loading && organization && !canView)
    return <ForbiddenState description="Ask for report access to see saved reports." />;
  return (
    <>
      <PageHeader
        title="Saved reports"
        description="Reusable report filters. Report logic remains tied to the current verified definition."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports">Report library</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} />
        <Card>
          {reports.length === 0 ? (
            <p className="rb-muted">No saved reports yet.</p>
          ) : (
            <div className="rb-saved-report-list">
              {reports.map((report) => (
                <div key={report.id} className="rb-saved-report-row">
                  <div>
                    <strong>{report.name}</strong>
                    <span>{report.reportKey}</span>
                  </div>
                  <div className="rb-report-export-actions">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/reports/${report.reportKey}?${filterParams(report.filters)}`}>
                        Open
                      </Link>
                    </Button>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${report.name}`}
                        onClick={() => void remove(report.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function ReportTable({ report, currency }: { report: ReportData; currency: string }) {
  return (
    <div className="rb-table-scroll">
      <table className="rb-table rb-report-table">
        <caption className="rb-visually-hidden">{report.definition.name}</caption>
        <thead>
          <tr>
            {report.definition.columns.map((column) => (
              <th
                key={column.key}
                className={
                  column.type === 'money' || column.type === 'number'
                    ? 'rb-table--right'
                    : undefined
                }
              >
                {column.label}
              </th>
            ))}
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.id}>
              {report.definition.columns.map((column) => (
                <td
                  key={column.key}
                  className={
                    column.type === 'money' || column.type === 'number'
                      ? 'rb-table--right rb-num'
                      : undefined
                  }
                >
                  {formatCell(
                    row.cells[column.key],
                    column,
                    String(row.cells.currency ?? currency),
                  )}
                </td>
              ))}
              <td>{row.source ? <Link href={row.source.href}>View source</Link> : '—'}</td>
            </tr>
          ))}
          {report.rows.length === 0 ? (
            <tr>
              <td colSpan={report.definition.columns.length + 1}>No activity for these filters.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="rb-report-pagination">
        Showing {report.rows.length} of {report.pagination.totalRows} rows.
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rb-field">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Messages({ error, notice }: { error?: string | null; notice?: string | null }) {
  return (
    <>
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rb-auth-success" role="status">
          {notice}
        </div>
      ) : null}
    </>
  );
}

function filterParams(filters: Partial<ReportFilters>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

function exportHref(
  organizationId: string | null,
  key: ReportKey,
  filters: Partial<ReportFilters>,
  format: string,
) {
  return apiDownloadUrl(
    `/organizations/${organizationId}/reports/${key}/export?${filterParams({ ...filters })}&format=${format}`,
  );
}

function formatCell(
  value: string | number | boolean | null | undefined,
  column: ReportColumn,
  currency: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = value.toString();
  if (column.type === 'money') return formatMinor(text, currency);
  if (column.type === 'percent') return `${text}%`;
  return text.replaceAll('_', ' ');
}

function formatMinor(value: string, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      Number(BigInt(value)) / 100,
    );
  } catch {
    return `${currency} ${value}`;
  }
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function yearStart(): string {
  return `${today().slice(0, 4)}-01-01`;
}
