'use client';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@retailbooks/ui';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

interface VarianceInsight {
  suggestionId: string;
  categoryId: string;
  categoryName: string;
  currentMinor: string;
  baselineMinor: string;
  variancePercent: number | null;
  direction: 'increase' | 'decrease' | 'new';
  reason: string;
}

interface CloseChecklist {
  unreconciledAccounts: {
    financialAccountId: string;
    accountName: string;
    lastCompletedAt: string | null;
  }[];
  pendingApprovals: number;
  missingDocumentExpenses: { id: string; expenseNumber: string | null; amountMinor: string }[];
  unresolvedBankTransactions: number;
  staleDraftCount: number;
}

interface CashFlowWeek {
  weekStart: string;
  expectedInflowsMinor: string;
  expectedOutflowsMinor: string;
  cumulativeBalanceMinor: string;
}

interface CashFlowScenario {
  openingBalanceMinor: string;
  onTime: CashFlowWeek[];
  delayedReceipts: CashFlowWeek[];
}

interface CollectionsCandidate {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string;
  balanceMinor: string;
  daysOverdue: number;
  exposureScore: number;
  suggestedAction: string;
}

interface PurchasingAdvice {
  itemId: string;
  itemName: string;
  warehouseName: string;
  quantityOnHand: string;
  reorderPoint: string;
  suggestedOrderQuantity: string;
  averageDailyOutflow: number;
  daysOfStockRemaining: number | null;
  urgent: boolean;
}

interface ProjectMarginAdvice {
  projectId: string;
  projectName: string;
  unbilledTimeMinor: string;
  unbilledExpenseMinor: string;
  currentMarginPercent: number | null;
  priorMarginPercent: number | null;
  marginErosion: boolean;
}

interface PolicyQaResult {
  source: 'COUNTRY_PACK' | 'TAX_PACK' | 'DOCUMENT_RULE';
  packCode: string;
  packVersion: string;
  documentType: string | null;
  text: string;
}

interface AuditEvidencePack {
  entityType: string;
  entityId: string;
  auditEvents: {
    eventKey: string;
    action: string;
    occurredAt: string;
    actorUserId: string | null;
  }[];
  attachments: { id: string; filename: string; createdAt: string }[];
  approvalRequests: {
    id: string;
    status: string;
    submittedAt: string;
    decisions: { decision: string; createdAt: string; comment: string | null }[];
  }[];
  journal: { id: string; reference: string | null; status: string; postedAt: string | null } | null;
  reversalJournal: { id: string; reference: string | null; postedAt: string | null } | null;
}

/**
 * Deterministic advisory signals (Phase 13E/13F): variance, month-end close checklist, cash-flow
 * scenarios, collections prioritization, inventory purchasing, project margin erosion, country-pack
 * policy Q&A, and audit evidence packs. Every panel here is a read-only view over existing records --
 * nothing on this page mutates a financial record, sends anything, or calls a model.
 */
export function InsightsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const currency = organization?.baseCurrency ?? 'KES';

  const [insights, setInsights] = useState<VarianceInsight[] | null>(null);
  const [checklist, setChecklist] = useState<CloseChecklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [varianceResponse, checklistResponse] = await Promise.all([
        apiRequest<{ data: VarianceInsight[] }>(
          `/organizations/${organizationId}/insights/variance`,
        ),
        apiRequest<{ data: CloseChecklist }>(
          `/organizations/${organizationId}/insights/close-checklist`,
        ),
      ]);
      setInsights(varianceResponse.data);
      setChecklist(checklistResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Insights could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(suggestionId: string) {
    if (!organizationId) return;
    setBusy(suggestionId);
    try {
      await apiRequest(`/organizations/${organizationId}/ai/suggestions/${suggestionId}/dismiss`, {
        method: 'POST',
      });
      setInsights(
        (current) => current?.filter((item) => item.suggestionId !== suggestionId) ?? null,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be dismissed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Spend insights"
        description="Deterministic planning and review signals -- all read-only and advisory."
      />
      <div className="rb-ledger-stack">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <Tabs defaultValue="overview" className="rb-ledger-stack">
          <TabsList aria-label="Insight categories">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="cash-flow">Cash flow</TabsTrigger>
            <TabsTrigger value="collections">Collections</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="project-margins">Project margins</TabsTrigger>
            <TabsTrigger value="policy-qa">Policy Q&amp;A</TabsTrigger>
            <TabsTrigger value="audit-evidence">Audit evidence</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="rb-ledger-stack">
              <Card>
                <strong>Month-end close checklist</strong>
                {checklist === null && !error ? <Skeleton /> : null}
                {checklist ? (
                  <ul className="rb-attachment-list">
                    <li>
                      <span>Unreconciled accounts</span>
                      <span className="rb-table-secondary">
                        {checklist.unreconciledAccounts.length === 0
                          ? 'None'
                          : checklist.unreconciledAccounts
                              .map((account) => account.accountName)
                              .join(', ')}
                      </span>
                    </li>
                    <li>
                      <span>Pending approvals</span>
                      <span className="rb-table-secondary">{checklist.pendingApprovals}</span>
                    </li>
                    <li>
                      <span>Posted expenses missing a receipt</span>
                      <span className="rb-table-secondary">
                        {checklist.missingDocumentExpenses.length}
                      </span>
                    </li>
                    <li>
                      <span>Unresolved bank transactions</span>
                      <span className="rb-table-secondary">
                        {checklist.unresolvedBankTransactions}
                      </span>
                    </li>
                    <li>
                      <span>Stale drafts (14+ days)</span>
                      <span className="rb-table-secondary">{checklist.staleDraftCount}</span>
                    </li>
                  </ul>
                ) : null}
              </Card>

              {insights === null && !error ? <Skeleton /> : null}
              {insights && insights.length === 0 ? (
                <EmptyState
                  title="Nothing notable"
                  description="No category is significantly above or below its trailing average this month."
                />
              ) : null}
              {insights?.map((insight) => (
                <Card key={insight.suggestionId} className="rb-report-actions">
                  <div>
                    <strong>{insight.categoryName}</strong>
                    <p className="rb-muted">{insight.reason}</p>
                  </div>
                  <Badge tone={insight.direction === 'increase' ? 'warning' : 'neutral'}>
                    {insight.direction === 'new' ? 'New spend' : `${insight.direction}`}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === insight.suggestionId}
                    onClick={() => void dismiss(insight.suggestionId)}
                  >
                    Dismiss
                  </Button>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="cash-flow">
            <CashFlowPanel organizationId={organizationId} currency={currency} />
          </TabsContent>

          <TabsContent value="collections">
            <CollectionsPanel organizationId={organizationId} currency={currency} />
          </TabsContent>

          <TabsContent value="inventory">
            <InventoryPanel organizationId={organizationId} />
          </TabsContent>

          <TabsContent value="project-margins">
            <ProjectMarginsPanel organizationId={organizationId} currency={currency} />
          </TabsContent>

          <TabsContent value="policy-qa">
            <PolicyQaPanel organizationId={organizationId} />
          </TabsContent>

          <TabsContent value="audit-evidence">
            <AuditEvidencePanel organizationId={organizationId} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function CashFlowPanel({
  organizationId,
  currency,
}: {
  organizationId: string | null;
  currency: string;
}) {
  const [scenario, setScenario] = useState<CashFlowScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<{ data: CashFlowScenario }>(`/organizations/${organizationId}/insights/cash-flow`)
      .then((response) => setScenario(response.data))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Cash flow could not be loaded.'),
      );
  }, [organizationId]);

  if (error) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }
  if (!scenario) return <Skeleton />;

  return (
    <Card>
      <strong>12-week cash-flow scenario</strong>
      <p className="rb-muted">
        Opening position {formatMinor(scenario.openingBalanceMinor, currency)}. "Delayed"
        mechanically shifts open receivables 30 days later -- it is not a probabilistic forecast.
      </p>
      <div className="rb-table-scroll">
        <table className="rb-table">
          <thead>
            <tr>
              <th>Week of</th>
              <th>Inflows</th>
              <th>Outflows</th>
              <th>Cumulative (on time)</th>
              <th>Cumulative (delayed receipts)</th>
            </tr>
          </thead>
          <tbody>
            {scenario.onTime.map((week, index) => (
              <tr key={week.weekStart}>
                <td>{week.weekStart}</td>
                <td>{formatMinor(week.expectedInflowsMinor, currency)}</td>
                <td>{formatMinor(week.expectedOutflowsMinor, currency)}</td>
                <td>{formatMinor(week.cumulativeBalanceMinor, currency)}</td>
                <td>
                  {formatMinor(
                    scenario.delayedReceipts[index]?.cumulativeBalanceMinor ?? '0',
                    currency,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CollectionsPanel({
  organizationId,
  currency,
}: {
  organizationId: string | null;
  currency: string;
}) {
  const [candidates, setCandidates] = useState<CollectionsCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<{ data: CollectionsCandidate[] }>(
      `/organizations/${organizationId}/insights/collections`,
    )
      .then((response) => setCandidates(response.data))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Collections could not be loaded.'),
      );
  }, [organizationId]);

  if (error) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }
  if (!candidates) return <Skeleton />;
  if (candidates.length === 0) {
    return (
      <EmptyState title="Nothing overdue" description="No open invoice is past its due date." />
    );
  }

  return (
    <div className="rb-ledger-stack">
      {candidates.map((candidate) => (
        <Card key={candidate.invoiceId} className="rb-report-actions">
          <div>
            <strong>
              {candidate.customerName}
              {candidate.invoiceNumber ? ` -- ${candidate.invoiceNumber}` : ''}
            </strong>
            <p className="rb-muted">{candidate.suggestedAction}</p>
          </div>
          <Badge tone={candidate.daysOverdue >= 60 ? 'danger' : 'warning'}>
            {candidate.daysOverdue} days overdue
          </Badge>
          <span>{formatMinor(candidate.balanceMinor, currency)}</span>
        </Card>
      ))}
    </div>
  );
}

function InventoryPanel({ organizationId }: { organizationId: string | null }) {
  const [advice, setAdvice] = useState<PurchasingAdvice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<{ data: PurchasingAdvice[] }>(
      `/organizations/${organizationId}/insights/inventory-purchasing`,
    )
      .then((response) => setAdvice(response.data))
      .catch((caught) =>
        setError(
          caught instanceof ApiError ? caught.message : 'Purchasing advice could not be loaded.',
        ),
      );
  }, [organizationId]);

  if (error) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }
  if (!advice) return <Skeleton />;
  if (advice.length === 0) {
    return (
      <EmptyState
        title="No reorders needed"
        description="No item is at or below its reorder threshold."
      />
    );
  }

  return (
    <div className="rb-ledger-stack">
      {advice.map((item) => (
        <Card key={`${item.itemId}-${item.warehouseName}`} className="rb-report-actions">
          <div>
            <strong>{item.itemName}</strong>
            <p className="rb-muted">
              {item.warehouseName} -- on hand {item.quantityOnHand}, reorder point{' '}
              {item.reorderPoint}, suggested order {item.suggestedOrderQuantity}
            </p>
          </div>
          {item.urgent ? <Badge tone="danger">Urgent</Badge> : null}
          <span className="rb-table-secondary">
            {item.daysOfStockRemaining === null
              ? 'No recent outflow to estimate days remaining'
              : `${Math.round(item.daysOfStockRemaining)} days of stock remaining`}
          </span>
        </Card>
      ))}
    </div>
  );
}

function ProjectMarginsPanel({
  organizationId,
  currency,
}: {
  organizationId: string | null;
  currency: string;
}) {
  const [advice, setAdvice] = useState<ProjectMarginAdvice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<{ data: ProjectMarginAdvice[] }>(
      `/organizations/${organizationId}/insights/project-margins`,
    )
      .then((response) => setAdvice(response.data))
      .catch((caught) =>
        setError(
          caught instanceof ApiError ? caught.message : 'Project margins could not be loaded.',
        ),
      );
  }, [organizationId]);

  if (error) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }
  if (!advice) return <Skeleton />;
  if (advice.length === 0) {
    return (
      <EmptyState
        title="Nothing unbilled"
        description="No project has unbilled time or expense right now."
      />
    );
  }

  return (
    <div className="rb-ledger-stack">
      {advice.map((project) => (
        <Card key={project.projectId} className="rb-report-actions">
          <div>
            <strong>{project.projectName}</strong>
            <p className="rb-muted">
              Unbilled time {formatMinor(project.unbilledTimeMinor, currency)}, unbilled expense{' '}
              {formatMinor(project.unbilledExpenseMinor, currency)}
            </p>
          </div>
          {project.marginErosion ? <Badge tone="danger">Margin erosion</Badge> : null}
          <span className="rb-table-secondary">
            {project.currentMarginPercent === null
              ? 'No posted margin yet'
              : `${project.currentMarginPercent.toFixed(1)}% (was ${
                  project.priorMarginPercent === null
                    ? 'n/a'
                    : `${project.priorMarginPercent.toFixed(1)}%`
                })`}
          </span>
        </Card>
      ))}
    </div>
  );
}

function PolicyQaPanel({ organizationId }: { organizationId: string | null }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PolicyQaResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!organizationId || query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ data: PolicyQaResult[] }>(
        `/organizations/${organizationId}/insights/policy-qa?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The search could not be completed.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rb-ledger-stack">
      <Card className="rb-report-filters">
        <div className="rb-field">
          <Label htmlFor="policy-qa-query">Search your adopted country pack</Label>
          <Input
            id="policy-qa-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void search();
            }}
            placeholder="VAT rate, invoice footer, required field…"
          />
        </div>
        <Button onClick={() => void search()} loading={loading} disabled={query.trim().length < 2}>
          <Search aria-hidden="true" /> Search
        </Button>
      </Card>
      <p className="rb-muted">
        This surfaces configured rules from your organization's adopted country pack. It is not
        legal or tax advice.
      </p>

      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {results && results.length === 0 ? (
        <EmptyState
          title="No matches"
          description="No configured rule in your adopted country pack matched that search."
        />
      ) : null}
      {results && results.length > 0 ? (
        <Card>
          <ul className="rb-attachment-list">
            {results.map((result, index) => (
              <li key={`${result.source}-${index}`}>
                <span>
                  {result.text}
                  {result.documentType ? ` (${label(result.documentType)})` : ''}
                </span>
                <span className="rb-table-secondary">
                  {label(result.source)} -- {result.packCode} v{result.packVersion}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

const AUDIT_EVIDENCE_ENTITY_TYPES = ['EXPENSE', 'BILL', 'INVOICE'] as const;

function AuditEvidencePanel({ organizationId }: { organizationId: string | null }) {
  const [entityType, setEntityType] =
    useState<(typeof AUDIT_EVIDENCE_ENTITY_TYPES)[number]>('EXPENSE');
  const [entityId, setEntityId] = useState('');
  const [pack, setPack] = useState<AuditEvidencePack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!organizationId || entityId.trim().length === 0) return;
    setLoading(true);
    setError(null);
    setPack(null);
    try {
      const response = await apiRequest<{ data: AuditEvidencePack }>(
        `/organizations/${organizationId}/insights/audit-evidence-pack?entityType=${entityType}&entityId=${encodeURIComponent(
          entityId.trim(),
        )}`,
      );
      setPack(response.data);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The evidence pack could not be assembled.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rb-ledger-stack">
      <Card className="rb-report-filters">
        <div className="rb-field">
          <Label htmlFor="audit-evidence-entity-type">Entity type</Label>
          <Select
            id="audit-evidence-entity-type"
            value={entityType}
            onChange={(event) =>
              setEntityType(event.target.value as (typeof AUDIT_EVIDENCE_ENTITY_TYPES)[number])
            }
          >
            {AUDIT_EVIDENCE_ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </Select>
        </div>
        <div className="rb-field">
          <Label htmlFor="audit-evidence-entity-id">Record ID</Label>
          <Input
            id="audit-evidence-entity-id"
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void lookup();
            }}
            placeholder="UUID"
          />
        </div>
        <Button
          onClick={() => void lookup()}
          loading={loading}
          disabled={entityId.trim().length === 0}
        >
          <Search aria-hidden="true" /> Assemble
        </Button>
      </Card>

      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}

      {pack ? (
        <div className="rb-ledger-stack">
          <Card>
            <strong>Audit trail</strong>
            {pack.auditEvents.length === 0 ? (
              <p className="rb-muted">No audit events recorded.</p>
            ) : (
              <ul className="rb-attachment-list">
                {pack.auditEvents.map((event) => (
                  <li key={event.eventKey}>
                    <span>{event.action}</span>
                    <span className="rb-table-secondary">
                      {new Date(event.occurredAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <strong>Attachments</strong>
            {pack.attachments.length === 0 ? (
              <p className="rb-muted">No attachments.</p>
            ) : (
              <ul className="rb-attachment-list">
                {pack.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <span>{attachment.filename}</span>
                    <span className="rb-table-secondary">
                      {new Date(attachment.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <strong>Approval requests</strong>
            {pack.approvalRequests.length === 0 ? (
              <p className="rb-muted">No approval requests.</p>
            ) : (
              <ul className="rb-attachment-list">
                {pack.approvalRequests.map((request) => (
                  <li key={request.id}>
                    <span>
                      {label(request.status)} -- submitted{' '}
                      {new Date(request.submittedAt).toLocaleString()}
                    </span>
                    <span className="rb-table-secondary">
                      {request.decisions.map((decision) => label(decision.decision)).join(', ') ||
                        'No decisions yet'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <strong>Posting</strong>
            {pack.journal ? (
              <ul className="rb-attachment-list">
                <li>
                  <span>Journal {pack.journal.reference ?? pack.journal.id}</span>
                  <span className="rb-table-secondary">
                    {label(pack.journal.status)}
                    {pack.journal.postedAt
                      ? ` -- ${new Date(pack.journal.postedAt).toLocaleString()}`
                      : ''}
                  </span>
                </li>
                {pack.reversalJournal ? (
                  <li>
                    <span>
                      Reversed by {pack.reversalJournal.reference ?? pack.reversalJournal.id}
                    </span>
                    <span className="rb-table-secondary">
                      {pack.reversalJournal.postedAt
                        ? new Date(pack.reversalJournal.postedAt).toLocaleString()
                        : ''}
                    </span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="rb-muted">No linked journal for this entity type yet.</p>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function formatMinor(value: string, currency: string): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat('en-KE').format(Number(whole));
  return `${negative ? '-' : ''}${currency} ${formattedWhole}.${cents.toString().padStart(2, '0')}`;
}

function label(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1)}${part.slice(1).toLowerCase()}`)
    .join(' ');
}
