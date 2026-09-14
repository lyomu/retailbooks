'use client';

import type {
  ExplainNumberExplanation,
  ExplainNumberResponse,
  ReportColumn,
  ReportDefinition,
  ReportDefinitionsResponse,
  ReportDrillDownData,
  ReportDrillDownResult,
  ReportFilters,
  ReportKey,
  ReportResult,
  ReportRow,
  SavedReport,
  SavedReportResponse,
  SavedReportsResponse,
} from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DrawerContent,
  ErrorState,
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
  const [explainTarget, setExplainTarget] = useState<{ row: ReportRow; label: string } | null>(
    null,
  );

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
        {report ? (
          <ReportTable
            report={report}
            currency={currency}
            onExplain={(row, label) => setExplainTarget({ row, label })}
          />
        ) : null}
        {explainTarget && organizationId && report ? (
          <NumberExplanationPanel
            organizationId={organizationId}
            reportKey={report.definition.key}
            filters={filters}
            row={explainTarget.row}
            label={explainTarget.label}
            currency={currency}
            canAskAi={hasPermission(organization, 'ai.assistant.ask')}
            onClose={() => setExplainTarget(null)}
          />
        ) : null}
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

function ReportTable({
  report,
  currency,
  onExplain,
}: {
  report: ReportData;
  currency: string;
  onExplain?: (row: ReportRow, label: string) => void;
}) {
  const canExplain = Boolean(onExplain) && report.definition.supportsDrillDown;
  const labelColumn = report.definition.columns[0];
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
            {canExplain ? <th>Explain</th> : null}
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
              {canExplain ? (
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onExplain?.(
                        row,
                        labelColumn
                          ? formatCell(row.cells[labelColumn.key], labelColumn, currency)
                          : row.id,
                      )
                    }
                  >
                    Explain
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
          {report.rows.length === 0 ? (
            <tr>
              <td colSpan={report.definition.columns.length + 1 + (canExplain ? 1 : 0)}>
                No activity for these filters.
              </td>
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

function pickDrillDownFilters(filters: Partial<ReportFilters>): Partial<ReportFilters> {
  const { from, to, basis, currencyMode, projectId, tagId } = filters;
  return { from, to, basis, currencyMode, projectId, tagId };
}

function NumberExplanationPanel({
  organizationId,
  reportKey,
  filters,
  row,
  label,
  currency,
  canAskAi,
  onClose,
}: {
  organizationId: string;
  reportKey: ReportKey;
  filters: Partial<ReportFilters>;
  row: ReportRow;
  label: string;
  currency: string;
  canAskAi: boolean;
  onClose: () => void;
}) {
  const [drillDown, setDrillDown] = useState<ReportDrillDownData | null>(null);
  const [explanation, setExplanation] = useState<ExplainNumberExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drillDownFilters = pickDrillDownFilters(filters);

  useEffect(() => {
    let cancelled = false;
    setDrillDown(null);
    setExplanation(null);
    setError(null);

    async function load() {
      try {
        if (canAskAi) {
          const response = await apiRequest<ExplainNumberResponse>(
            `/organizations/${organizationId}/ai/explain-number`,
            {
              method: 'POST',
              body: JSON.stringify({ reportKey, rowId: row.id, ...drillDownFilters }),
            },
          );
          if (cancelled) return;
          setDrillDown(response.data.drillDown);
          setExplanation(response.data.explanation);
        } else {
          const query = filterParams(drillDownFilters);
          const response = await apiRequest<ReportDrillDownResult>(
            `/organizations/${organizationId}/reports/${encodeURIComponent(reportKey)}/rows/${row.id}/drill-down?${query}`,
          );
          if (cancelled) return;
          setDrillDown(response.data);
          setExplanation({ state: 'unavailable', reason: 'AI_NOT_PERMITTED' });
        }
      } catch (caught) {
        if (!cancelled) setError(message(caught, 'This number could not be explained.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // drillDownFilters is derived fresh from filters every render; depend on its fields directly
    // rather than the object reference so a same-value refresh doesn't re-fetch.
  }, [
    organizationId,
    reportKey,
    row.id,
    canAskAi,
    drillDownFilters.from,
    drillDownFilters.to,
    drillDownFilters.basis,
    drillDownFilters.currencyMode,
    drillDownFilters.projectId,
    drillDownFilters.tagId,
  ]);

  const labelColumn = drillDown?.definition.columns[0];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        side="right"
        title={`Explain ${label}`}
        description="Deterministic breakdown and, if available, an AI interpretation."
      >
        <div className="rb-explain-panel">
          {error ? (
            <ErrorState title="This number could not be explained" description={error} />
          ) : null}
          {!drillDown && !error ? <Skeleton /> : null}
          {drillDown ? (
            <>
              <div className="rb-explain-summary-row">
                <strong>{label}</strong>
                {drillDown.definition.columns
                  .filter((column) => column.key !== labelColumn?.key)
                  .map((column) => (
                    <span key={column.key}>
                      {column.label}:{' '}
                      {formatCell(drillDown.row.cells[column.key], column, currency)}
                    </span>
                  ))}
              </div>
              <p className="rb-muted">Lines reconcile exactly to the reported total.</p>
              <div className="rb-table-scroll">
                <table className="rb-table">
                  <caption className="rb-visually-hidden">Contributing entries for {label}</caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reference</th>
                      <th>Description</th>
                      <th className="rb-table--right">Debit</th>
                      <th className="rb-table--right">Credit</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillDown.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{String(line.cells.date ?? '—')}</td>
                        <td>{String(line.cells.reference ?? '—')}</td>
                        <td>{String(line.cells.description ?? '—')}</td>
                        <td className="rb-table--right rb-num">
                          {formatMinor(String(line.cells.debitMinor ?? '0'), currency)}
                        </td>
                        <td className="rb-table--right rb-num">
                          {formatMinor(String(line.cells.creditMinor ?? '0'), currency)}
                        </td>
                        <td>
                          {line.source ? <Link href={line.source.href}>View source</Link> : '—'}
                        </td>
                      </tr>
                    ))}
                    {drillDown.lines.length === 0 ? (
                      <tr>
                        <td colSpan={6}>No contributing entries.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="rb-explain-ai" aria-live="polite">
                {renderExplanation(explanation, canAskAi)}
              </div>
            </>
          ) : null}
        </div>
      </DrawerContent>
    </Dialog>
  );
}

function renderExplanation(
  explanation: ExplainNumberExplanation | null,
  canAskAi: boolean,
): React.ReactNode {
  if (!canAskAi) {
    return (
      <Badge tone="neutral">
        Your role can view the breakdown above; AI explanations need the assistant permission.
      </Badge>
    );
  }
  if (!explanation) return <Skeleton />;
  if (explanation.state === 'unavailable') {
    return (
      <div className="rb-explain-unavailable">
        <Badge tone="warning">AI explanation unavailable</Badge>
        <p className="rb-muted">{unavailableReasonCopy(explanation.reason)}</p>
      </div>
    );
  }
  if (explanation.abstained) {
    return (
      <p className="rb-muted">
        The assistant couldn’t confirm an explanation from the available evidence.
      </p>
    );
  }
  return (
    <div className="rb-explain-ready">
      <p>{explanation.summary}</p>
      {explanation.citations.length > 0 ? (
        <ul className="rb-explain-citations">
          {explanation.citations.map((citation) => (
            <li key={citation.sourceId}>
              {citation.href ? <Link href={citation.href}>View source</Link> : citation.sourceType}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="rb-muted rb-explain-caption">
        AI-written interpretation of the evidence above. It is not verified fact and never changes
        the reported amount.
      </p>
    </div>
  );
}

function unavailableReasonCopy(reason: string): string {
  if (reason === 'MODEL_DISABLED') return 'AI is turned off for this workspace.';
  if (reason === 'AI_NOT_PERMITTED') return 'Your role does not have the AI assistant permission.';
  if (reason === 'MODEL_EVIDENCE_STALE')
    return 'The underlying data changed while preparing this explanation.';
  return 'The AI explanation service is temporarily unavailable.';
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
