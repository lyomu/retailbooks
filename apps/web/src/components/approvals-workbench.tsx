'use client';

import type { OrganizationMember } from '@retailbooks/contracts';
import {
  Button,
  Card,
  DataTable,
  Dialog,
  DialogContent,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  type DataTableColumn,
} from '@retailbooks/ui';
import { Ban, CheckCircle2, History, Inbox, Send, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

const TARGET_TYPES = [
  'QUOTE',
  'SALES_ORDER',
  'INVOICE',
  'CREDIT_NOTE',
  'PURCHASE_ORDER',
  'BILL',
  'PAYMENT_MADE',
  'INVENTORY_ADJUSTMENT',
  'JOURNAL',
] as const;
type ApprovalTargetType = (typeof TARGET_TYPES)[number];

type ApprovalPolicyStep = {
  id: string;
  stepNumber: number;
  approverUserId: string | null;
  requiredPermission: string | null;
  label: string | null;
};

type ApprovalPolicy = {
  id: string;
  name: string;
  targetType: ApprovalTargetType;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  priority: number;
  conditions: Record<string, unknown>;
  allowSelfApproval: boolean;
  version: number;
  steps: ApprovalPolicyStep[];
};

type ApprovalRequestStep = {
  id: string;
  stepNumber: number;
  approverUserId: string | null;
  requiredPermission: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED';
  decidedByUserId: string | null;
  decidedAt: string | null;
};

type ApprovalRequest = {
  id: string;
  policyId: string;
  submitterUserId: string;
  targetType: ApprovalTargetType;
  targetId: string;
  targetSnapshot: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  currentStepNumber: number;
  submittedAt: string;
  completedAt: string | null;
  steps: ApprovalRequestStep[];
};

type ApprovalDecision = {
  id: string;
  stepId: string;
  actorUserId: string;
  decision: 'APPROVED' | 'REJECTED';
  comment: string | null;
  createdAt: string;
};

type ApprovalRequestDetail = Omit<ApprovalRequest, 'steps'> & {
  policy: ApprovalPolicy;
  steps: (ApprovalRequestStep & { decisions: ApprovalDecision[] })[];
};

type ApprovalInboxItem = ApprovalRequestStep & {
  request: ApprovalRequest & { policy: ApprovalPolicy };
};

export function ApprovalsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'automation.approvals.view');
  const canManage = hasPermission(organization, 'automation.approvals.manage');

  const [detailId, setDetailId] = useState<string | null>(null);

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask for approvals access to review or submit approval requests." />
    );
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Review documents routed to you, track what you've submitted, and manage the policies that decide who signs off."
      />
      <Tabs defaultValue="inbox" className="rb-ledger-stack">
        <TabsList>
          <TabsTrigger value="inbox">
            <Inbox aria-hidden="true" /> My inbox
          </TabsTrigger>
          <TabsTrigger value="mine">
            <Send aria-hidden="true" /> Submitted by me
          </TabsTrigger>
          <TabsTrigger value="submit">
            <ShieldCheck aria-hidden="true" /> Submit a document
          </TabsTrigger>
          {canManage ? (
            <TabsTrigger value="policies">
              <History aria-hidden="true" /> Policies
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="inbox">
          <InboxPanel organizationId={organizationId} onOpen={setDetailId} />
        </TabsContent>
        <TabsContent value="mine">
          <SubmittedByMePanel organizationId={organizationId} onOpen={setDetailId} />
        </TabsContent>
        <TabsContent value="submit">
          <SubmitPanel organizationId={organizationId} />
        </TabsContent>
        {canManage ? (
          <TabsContent value="policies">
            <PoliciesPanel organizationId={organizationId} />
          </TabsContent>
        ) : null}
      </Tabs>
      {detailId && organizationId ? (
        <RequestDetailPanel
          organizationId={organizationId}
          requestId={detailId}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </>
  );
}

function InboxPanel({
  organizationId,
  onOpen,
}: {
  organizationId: string | null;
  onOpen: (requestId: string) => void;
}) {
  const [items, setItems] = useState<ApprovalInboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<{ data: ApprovalInboxItem[] }>(
        `/organizations/${organizationId}/automation/approval-policies/inbox`,
      );
      setItems(response.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Your approval inbox could not be loaded.'));
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: ApprovalInboxItem, decision: 'APPROVED' | 'REJECTED') {
    if (!organizationId) return;
    const comment = comments[item.id]?.trim();
    if (decision === 'REJECTED' && !comment) {
      setError('Say why the request is being rejected so the submitter can act on it.');
      return;
    }
    setBusyId(item.id);
    setError(null);
    try {
      await apiRequest(
        `/organizations/${organizationId}/automation/approval-policies/requests/${item.request.id}/decision`,
        { method: 'POST', body: JSON.stringify({ decision, comment: comment || undefined }) },
      );
      setNotice(decision === 'APPROVED' ? 'Step approved.' : 'Request rejected.');
      await load();
    } catch (caught) {
      setError(message(caught, 'The decision could not be recorded.'));
    } finally {
      setBusyId(null);
    }
  }

  const columns: readonly DataTableColumn<ApprovalInboxItem>[] = [
    {
      key: 'target',
      header: 'Document',
      cell: (item) => (
        <button type="button" className="rb-link-button" onClick={() => onOpen(item.request.id)}>
          {targetLabel(item.request.targetType)} · {snapshotSummary(item.request)}
        </button>
      ),
    },
    { key: 'policy', header: 'Policy', cell: (item) => item.request.policy.name },
    { key: 'step', header: 'Step', cell: (item) => `${item.stepNumber}` },
    { key: 'submitted', header: 'Submitted', cell: (item) => formatDate(item.request.submittedAt) },
    {
      key: 'comment',
      header: 'Decision note',
      cell: (item) => (
        <Textarea
          aria-label="Decision comment"
          rows={1}
          value={comments[item.id] ?? ''}
          onChange={(event) =>
            setComments((current) => ({ ...current, [item.id]: event.target.value }))
          }
          placeholder="Required to reject"
        />
      ),
      hideBelow: 'desktop',
    },
    {
      key: 'actions',
      header: 'Decision',
      cell: (item) => (
        <div className="rb-ledger-row-actions">
          <Button
            type="button"
            size="sm"
            loading={busyId === item.id}
            onClick={() => void decide(item, 'APPROVED')}
          >
            <CheckCircle2 aria-hidden="true" /> Approve
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busyId === item.id}
            onClick={() => void decide(item, 'REJECTED')}
          >
            <XCircle aria-hidden="true" /> Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="rb-ledger-stack">
      <Messages error={error} notice={notice} />
      {items === null ? <Skeleton /> : null}
      {items && items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting on you"
          description="Requests assigned to your role or to you by name will appear here."
        />
      ) : null}
      {items && items.length > 0 ? (
        <DataTable caption="Approval inbox" columns={columns} rows={items} />
      ) : null}
    </div>
  );
}

function SubmittedByMePanel({
  organizationId,
  onOpen,
}: {
  organizationId: string | null;
  onOpen: (requestId: string) => void;
}) {
  const [requests, setRequests] = useState<ApprovalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<{ data: ApprovalRequest[] }>(
        `/organizations/${organizationId}/automation/approval-policies/requests/mine`,
      );
      setRequests(response.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Your submitted requests could not be loaded.'));
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(request: ApprovalRequest) {
    if (!organizationId) return;
    setBusyId(request.id);
    setError(null);
    try {
      await apiRequest(
        `/organizations/${organizationId}/automation/approval-policies/requests/${request.id}/cancel`,
        { method: 'POST' },
      );
      setNotice('Request cancelled.');
      await load();
    } catch (caught) {
      setError(message(caught, 'The request could not be cancelled.'));
    } finally {
      setBusyId(null);
    }
  }

  const columns: readonly DataTableColumn<ApprovalRequest>[] = [
    {
      key: 'target',
      header: 'Document',
      cell: (request) => (
        <button type="button" className="rb-link-button" onClick={() => onOpen(request.id)}>
          {targetLabel(request.targetType)} · {snapshotSummary(request)}
        </button>
      ),
    },
    { key: 'status', header: 'Status', cell: (request) => <StatusBadge status={request.status} /> },
    {
      key: 'step',
      header: 'Step',
      cell: (request) =>
        request.status === 'PENDING'
          ? `${request.currentStepNumber} of ${request.steps.length}`
          : '—',
    },
    { key: 'submitted', header: 'Submitted', cell: (request) => formatDate(request.submittedAt) },
    {
      key: 'actions',
      header: '',
      cell: (request) =>
        request.status === 'PENDING' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busyId === request.id}
            onClick={() => void cancel(request)}
          >
            <Ban aria-hidden="true" /> Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="rb-ledger-stack">
      <Messages error={error} notice={notice} />
      {requests === null ? <Skeleton /> : null}
      {requests && requests.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nothing submitted yet"
          description="Documents you submit for approval will show up here."
        />
      ) : null}
      {requests && requests.length > 0 ? (
        <DataTable caption="Requests I submitted" columns={columns} rows={requests} />
      ) : null}
    </div>
  );
}

function SubmitPanel({ organizationId }: { organizationId: string | null }) {
  const [targetType, setTargetType] = useState<ApprovalTargetType>('INVOICE');
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    if (!organizationId || !targetId.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/organizations/${organizationId}/automation/approval-requests`, {
        method: 'POST',
        body: JSON.stringify({ targetType, targetId: targetId.trim() }),
      });
      setNotice('Submitted for approval.');
      setTargetId('');
    } catch (caught) {
      setError(message(caught, 'The document could not be submitted for approval.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <p>
        Route an existing document into an active approval policy. Copy its ID from the
        document&rsquo;s own page — this freezes its current state until a decision is made.
      </p>
      <Messages error={error} notice={notice} />
      <div className="rb-field">
        <Label htmlFor="submit-target-type">Document type</Label>
        <Select
          id="submit-target-type"
          value={targetType}
          onChange={(event) => setTargetType(event.target.value as ApprovalTargetType)}
        >
          {TARGET_TYPES.map((type) => (
            <option key={type} value={type}>
              {targetLabel(type)}
            </option>
          ))}
        </Select>
      </div>
      <div className="rb-field">
        <Label htmlFor="submit-target-id">Document ID</Label>
        <Input
          id="submit-target-id"
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </div>
      <Button
        type="button"
        loading={busy}
        disabled={!targetId.trim()}
        onClick={() => void submit()}
      >
        <Send aria-hidden="true" /> Submit for approval
      </Button>
    </Card>
  );
}

function PoliciesPanel({ organizationId }: { organizationId: string | null }) {
  const [policies, setPolicies] = useState<ApprovalPolicy[] | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState<ApprovalTargetType>('INVOICE');
  const [priority, setPriority] = useState('0');
  const [allowSelfApproval, setAllowSelfApproval] = useState(false);
  const [steps, setSteps] = useState<
    { approverUserId: string; requiredPermission: string; label: string }[]
  >([{ approverUserId: '', requiredPermission: '', label: '' }]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [policyResponse, memberResponse] = await Promise.all([
        apiRequest<{ data: ApprovalPolicy[] }>(
          `/organizations/${organizationId}/automation/approval-policies`,
        ),
        apiRequest<{ data: OrganizationMember[] }>(`/organizations/${organizationId}/members`),
      ]);
      setPolicies(policyResponse.data);
      setMembers(memberResponse.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Approval policies could not be loaded.'));
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createPolicy() {
    if (!organizationId || !name.trim()) return;
    const cleanSteps = steps
      .filter((step) => step.approverUserId || step.requiredPermission)
      .map((step) => ({
        approverUserId: step.approverUserId || undefined,
        requiredPermission: step.requiredPermission || undefined,
        label: step.label || undefined,
      }));
    if (!cleanSteps.length) {
      setError('Add at least one step with an approver or a required permission.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/automation/approval-policies`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          targetType,
          priority: Number(priority) || 0,
          allowSelfApproval,
          steps: cleanSteps,
        }),
      });
      setNotice('Policy created as a draft. Activate it once its steps look right.');
      setName('');
      setSteps([{ approverUserId: '', requiredPermission: '', label: '' }]);
      await load();
    } catch (caught) {
      setError(message(caught, 'The policy could not be created.'));
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(policy: ApprovalPolicy, status: 'ACTIVE' | 'INACTIVE') {
    if (!organizationId) return;
    setBusyId(policy.id);
    setError(null);
    try {
      await apiRequest(
        `/organizations/${organizationId}/automation/approval-policies/${policy.id}/${status === 'ACTIVE' ? 'activate' : 'deactivate'}`,
        { method: 'POST' },
      );
      setNotice(status === 'ACTIVE' ? 'Policy activated.' : 'Policy deactivated.');
      await load();
    } catch (caught) {
      setError(message(caught, 'The policy status could not be changed.'));
    } finally {
      setBusyId(null);
    }
  }

  const columns: readonly DataTableColumn<ApprovalPolicy>[] = [
    { key: 'name', header: 'Name', cell: (policy) => <strong>{policy.name}</strong> },
    { key: 'target', header: 'Applies to', cell: (policy) => targetLabel(policy.targetType) },
    { key: 'status', header: 'Status', cell: (policy) => <StatusBadge status={policy.status} /> },
    { key: 'priority', header: 'Priority', cell: (policy) => `${policy.priority}` },
    { key: 'steps', header: 'Steps', cell: (policy) => `${policy.steps.length}` },
    {
      key: 'actions',
      header: '',
      cell: (policy) =>
        policy.status === 'ACTIVE' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busyId === policy.id}
            onClick={() => void setStatus(policy, 'INACTIVE')}
          >
            Deactivate
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            loading={busyId === policy.id}
            onClick={() => void setStatus(policy, 'ACTIVE')}
          >
            Activate
          </Button>
        ),
    },
  ];

  return (
    <div className="rb-ledger-stack">
      <Messages error={error} notice={notice} />
      <Card className="rb-ledger-form-card">
        <h2>New policy</h2>
        <div className="rb-field">
          <Label htmlFor="policy-name">Name</Label>
          <Input id="policy-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="rb-field">
          <Label htmlFor="policy-target">Applies to</Label>
          <Select
            id="policy-target"
            value={targetType}
            onChange={(event) => setTargetType(event.target.value as ApprovalTargetType)}
          >
            {TARGET_TYPES.map((type) => (
              <option key={type} value={type}>
                {targetLabel(type)}
              </option>
            ))}
          </Select>
        </div>
        <div className="rb-field">
          <Label htmlFor="policy-priority">
            Priority (higher wins when more than one active policy could match)
          </Label>
          <Input
            id="policy-priority"
            type="number"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </div>
        <label className="rb-checkbox-field">
          <input
            type="checkbox"
            checked={allowSelfApproval}
            onChange={(event) => setAllowSelfApproval(event.target.checked)}
          />
          Allow the submitter to approve their own request
        </label>
        <div className="rb-field">
          <Label>Steps, in order</Label>
          {steps.map((step, index) => (
            <div key={index} className="rb-inline-fields">
              <Select
                aria-label={`Step ${index + 1} approver`}
                value={step.approverUserId}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, approverUserId: event.target.value } : item,
                    ),
                  )
                }
              >
                <option value="">No specific approver</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Step ${index + 1} required permission`}
                placeholder="or a required permission key"
                value={step.requiredPermission}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, requiredPermission: event.target.value } : item,
                    ),
                  )
                }
              />
              <Input
                aria-label={`Step ${index + 1} label`}
                placeholder="Label (optional)"
                value={step.label}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, label: event.target.value } : item,
                    ),
                  )
                }
              />
              {steps.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSteps((current) => [
                ...current,
                { approverUserId: '', requiredPermission: '', label: '' },
              ])
            }
          >
            Add step
          </Button>
        </div>
        <Button
          type="button"
          loading={creating}
          disabled={!name.trim()}
          onClick={() => void createPolicy()}
        >
          Create policy
        </Button>
      </Card>
      {policies === null ? <Skeleton /> : null}
      {policies && policies.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No approval policies yet"
          description="Create one above to start routing documents for sign-off."
        />
      ) : null}
      {policies && policies.length > 0 ? (
        <DataTable caption="Approval policies" columns={columns} rows={policies} />
      ) : null}
    </div>
  );
}

function RequestDetailPanel({
  organizationId,
  requestId,
  onClose,
}: {
  organizationId: string;
  requestId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ApprovalRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ data: ApprovalRequestDetail }>(
      `/organizations/${organizationId}/automation/approval-policies/requests/${requestId}`,
    )
      .then((response) => {
        if (!cancelled) setDetail(response.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(message(caught, 'This request could not be loaded.'));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, requestId]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="Request history"
        description={
          detail
            ? `${targetLabel(detail.targetType)} · ${snapshotSummary(detail)} · policy ${detail.policy.name}`
            : undefined
        }
      >
        {error ? <Messages error={error} /> : null}
        {!detail && !error ? <Skeleton /> : null}
        {detail ? (
          <ol className="rb-timeline">
            {detail.steps.map((step) => (
              <li key={step.id} className="rb-timeline__entry">
                <div className="rb-timeline__head">
                  <strong>Step {step.stepNumber}</strong>
                  <StatusBadge status={step.status} />
                </div>
                {step.decisions.map((decision) => (
                  <p key={decision.id}>
                    {decision.decision === 'APPROVED' ? 'Approved' : 'Rejected'} on{' '}
                    {formatDate(decision.createdAt)}
                    {decision.comment ? ` — "${decision.comment}"` : ''}
                  </p>
                ))}
                {step.status === 'PENDING' ? <p>Awaiting a decision.</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function targetLabel(type: ApprovalTargetType): string {
  return type
    .toLowerCase()
    .split('_')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function snapshotSummary(request: {
  targetSnapshot: Record<string, unknown>;
  targetId: string;
}): string {
  const snapshot = request.targetSnapshot;
  const number = typeof snapshot.documentNumber === 'string' ? snapshot.documentNumber : null;
  const name =
    (typeof snapshot.contactName === 'string' && snapshot.contactName) ||
    (typeof snapshot.vendorName === 'string' && snapshot.vendorName) ||
    null;
  return [number ?? request.targetId.slice(0, 8), name].filter(Boolean).join(' · ');
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof ApiError || caught instanceof Error ? caught.message : fallback;
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
