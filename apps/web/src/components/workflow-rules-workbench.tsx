'use client';

import {
  DOMAIN_EVENT_NAMES,
  type DomainEventName,
  type OrganizationMember,
} from '@retailbooks/contracts';
import {
  Badge,
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
  Textarea,
  type DataTableColumn,
} from '@retailbooks/ui';
import { FlaskConical, History, Pencil, Workflow } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

const TRIGGERS = DOMAIN_EVENT_NAMES;

const OPERATORS = ['equals', 'notEquals', 'exists', 'greaterThan', 'lessThan', 'in'] as const;

type ConditionDraft = { field: string; operator: (typeof OPERATORS)[number]; value: string };
type ActionDraft =
  | {
      type: 'CREATE_NOTIFICATION';
      recipientUserId: string;
      title: string;
      body: string;
      href: string;
    }
  | { type: 'CREATE_TASK'; title: string; detail: string; assignedToUserId: string };

type WorkflowRule = {
  id: string;
  name: string;
  trigger: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  conditions: { field: string; operator: string; value?: unknown }[];
  actions: unknown[];
  version: number;
};

type WorkflowRun = {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  result: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type DryRunResult = {
  trigger: string;
  matched: boolean;
  conditionResults: { field: string; operator: string; value?: unknown; matched: boolean }[];
  actionsPreview: Record<string, unknown>[];
};

export function WorkflowRulesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'automation.rules.view');
  const canManage = hasPermission(organization, 'automation.rules.manage');

  const [rules, setRules] = useState<WorkflowRule[] | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [detailRuleId, setDetailRuleId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<DomainEventName>(TRIGGERS[0]);
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [actions, setActions] = useState<ActionDraft[]>([
    { type: 'CREATE_NOTIFICATION', recipientUserId: '', title: '', body: '', href: '' },
  ]);

  function resetForm() {
    setEditingRuleId(null);
    setName('');
    setTrigger(TRIGGERS[0]);
    setConditions([]);
    setActions([
      { type: 'CREATE_NOTIFICATION', recipientUserId: '', title: '', body: '', href: '' },
    ]);
  }

  function startEditing(rule: WorkflowRule) {
    setEditingRuleId(rule.id);
    setName(rule.name);
    setTrigger(rule.trigger as DomainEventName);
    setConditions(
      rule.conditions.map((condition) => ({
        field: condition.field,
        operator: condition.operator as ConditionDraft['operator'],
        value: Array.isArray(condition.value)
          ? condition.value.map(stringifyValue).join(', ')
          : stringifyValue(condition.value),
      })),
    );
    const rawActions = rule.actions as Array<Record<string, unknown>>;
    setActions(
      rawActions.length
        ? rawActions.map((action) =>
            action.type === 'CREATE_NOTIFICATION'
              ? {
                  type: 'CREATE_NOTIFICATION',
                  recipientUserId: stringifyValue(action.recipientUserId),
                  title: stringifyValue(action.title),
                  body: stringifyValue(action.body),
                  href: stringifyValue(action.href),
                }
              : {
                  type: 'CREATE_TASK',
                  title: stringifyValue(action.title),
                  detail: stringifyValue(action.detail),
                  assignedToUserId: stringifyValue(action.assignedToUserId),
                },
          )
        : [{ type: 'CREATE_NOTIFICATION', recipientUserId: '', title: '', body: '', href: '' }],
    );
  }

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [ruleResponse, memberResponse] = await Promise.all([
        apiRequest<{ data: WorkflowRule[] }>(
          `/organizations/${organizationId}/automation/workflow-rules`,
        ),
        apiRequest<{ data: OrganizationMember[] }>(`/organizations/${organizationId}/members`),
      ]);
      setRules(ruleResponse.data);
      setMembers(memberResponse.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Workflow rules could not be loaded.'));
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRule() {
    if (!organizationId || !name.trim()) return;
    const cleanActions = actions
      .filter((action) => action.title.trim())
      .map((action) =>
        action.type === 'CREATE_NOTIFICATION'
          ? {
              type: 'CREATE_NOTIFICATION' as const,
              recipientUserId: action.recipientUserId,
              title: action.title.trim(),
              body: action.body.trim() || undefined,
              href: action.href.trim() || undefined,
            }
          : {
              type: 'CREATE_TASK' as const,
              title: action.title.trim(),
              detail: action.detail.trim() || undefined,
              assignedToUserId: action.assignedToUserId || undefined,
            },
      );
    if (!cleanActions.length) {
      setError('Add at least one action with a title.');
      return;
    }
    if (
      cleanActions.some(
        (action) => action.type === 'CREATE_NOTIFICATION' && !action.recipientUserId,
      )
    ) {
      setError('Every "create notification" action needs a recipient.');
      return;
    }
    const cleanConditions = conditions
      .filter((condition) => condition.field.trim())
      .map((condition) => ({
        field: condition.field.trim(),
        operator: condition.operator,
        value:
          condition.operator === 'exists'
            ? undefined
            : condition.operator === 'in'
              ? condition.value.split(',').map((item) => parseValue(item.trim()))
              : parseValue(condition.value),
      }));
    setCreating(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        trigger,
        conditions: cleanConditions,
        actions: cleanActions,
      });
      if (editingRuleId) {
        await apiRequest(
          `/organizations/${organizationId}/automation/workflow-rules/${editingRuleId}`,
          {
            method: 'PATCH',
            body,
          },
        );
        setNotice('Rule updated.');
      } else {
        await apiRequest(`/organizations/${organizationId}/automation/workflow-rules`, {
          method: 'POST',
          body,
        });
        setNotice('Rule created as a draft. Activate it once it looks right.');
      }
      resetForm();
      await load();
    } catch (caught) {
      setError(
        message(
          caught,
          editingRuleId ? 'The rule could not be updated.' : 'The rule could not be created.',
        ),
      );
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(rule: WorkflowRule, status: 'ACTIVE' | 'INACTIVE') {
    if (!organizationId) return;
    setBusyId(rule.id);
    setError(null);
    try {
      await apiRequest(
        `/organizations/${organizationId}/automation/workflow-rules/${rule.id}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        },
      );
      setNotice(status === 'ACTIVE' ? 'Rule activated.' : 'Rule deactivated.');
      await load();
    } catch (caught) {
      setError(message(caught, 'The rule status could not be changed.'));
    } finally {
      setBusyId(null);
    }
  }

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for automation access to review workflow rules." />;
  }

  const columns: readonly DataTableColumn<WorkflowRule>[] = [
    { key: 'name', header: 'Name', cell: (rule) => <strong>{rule.name}</strong> },
    { key: 'trigger', header: 'Trigger', cell: (rule) => <code>{rule.trigger}</code> },
    { key: 'status', header: 'Status', cell: (rule) => <StatusBadge status={rule.status} /> },
    { key: 'conditions', header: 'Conditions', cell: (rule) => `${rule.conditions.length}` },
    { key: 'actions', header: 'Actions', cell: (rule) => `${rule.actions.length}` },
    {
      key: 'actions-cell',
      header: '',
      cell: (rule) => (
        <div className="rb-ledger-row-actions">
          <Button type="button" variant="ghost" size="sm" onClick={() => setDetailRuleId(rule.id)}>
            <FlaskConical aria-hidden="true" /> Test &amp; history
          </Button>
          {canManage && rule.status !== 'ACTIVE' ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => startEditing(rule)}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
          ) : null}
          {canManage ? (
            rule.status === 'ACTIVE' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={busyId === rule.id}
                onClick={() => void setStatus(rule, 'INACTIVE')}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                loading={busyId === rule.id}
                onClick={() => void setStatus(rule, 'ACTIVE')}
              >
                Activate
              </Button>
            )
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Workflow rules"
        description="Trigger a notification or a task automatically when an accounting event happens. No arbitrary code — every trigger, condition, and action is from a fixed, safe list."
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {canManage ? (
          <Card className="rb-ledger-form-card">
            <h2>{editingRuleId ? 'Edit rule' : 'New rule'}</h2>
            <div className="rb-field">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="rule-trigger">When this happens</Label>
              <Select
                id="rule-trigger"
                value={trigger}
                onChange={(event) => setTrigger(event.target.value as (typeof TRIGGERS)[number])}
              >
                {TRIGGERS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>

            <div className="rb-field">
              <Label>Conditions (all must match; leave empty to always run)</Label>
              {conditions.map((condition, index) => (
                <div key={index} className="rb-inline-fields">
                  <Input
                    aria-label="Field"
                    placeholder="payload field, e.g. totalMinor"
                    value={condition.field}
                    onChange={(event) =>
                      setConditions((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, field: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Select
                    aria-label="Operator"
                    value={condition.operator}
                    onChange={(event) =>
                      setConditions((current) =>
                        current.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                operator: event.target.value as ConditionDraft['operator'],
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </Select>
                  {condition.operator !== 'exists' ? (
                    <Input
                      aria-label="Value"
                      placeholder={condition.operator === 'in' ? 'Comma-separated values' : 'Value'}
                      value={condition.value}
                      onChange={(event) =>
                        setConditions((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, value: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setConditions((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setConditions((current) => [
                    ...current,
                    { field: '', operator: 'equals', value: '' },
                  ])
                }
              >
                Add condition
              </Button>
            </div>

            <div className="rb-field">
              <Label>Actions, in order</Label>
              {actions.map((action, index) => (
                <Card key={index} className="rb-ledger-form-card">
                  <div className="rb-inline-fields">
                    <Select
                      aria-label="Action type"
                      value={action.type}
                      onChange={(event) =>
                        setActions((current) =>
                          current.map((item, i) =>
                            i === index
                              ? event.target.value === 'CREATE_NOTIFICATION'
                                ? {
                                    type: 'CREATE_NOTIFICATION',
                                    recipientUserId: '',
                                    title: '',
                                    body: '',
                                    href: '',
                                  }
                                : {
                                    type: 'CREATE_TASK',
                                    title: '',
                                    detail: '',
                                    assignedToUserId: '',
                                  }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="CREATE_NOTIFICATION">Create notification</option>
                      <option value="CREATE_TASK">Create task</option>
                    </Select>
                    {actions.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setActions((current) => current.filter((_, i) => i !== index))
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  {action.type === 'CREATE_NOTIFICATION' ? (
                    <>
                      <div className="rb-field">
                        <Label htmlFor={`action-${index}-recipient`}>Recipient</Label>
                        <Select
                          id={`action-${index}-recipient`}
                          value={action.recipientUserId}
                          onChange={(event) =>
                            setActions((current) =>
                              current.map((item, i) =>
                                i === index && item.type === 'CREATE_NOTIFICATION'
                                  ? { ...item, recipientUserId: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="">Choose a member</option>
                          {members.map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.displayName}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="rb-field">
                        <Label htmlFor={`action-${index}-title`}>
                          Title (use {'{{field}}'} to interpolate the event payload)
                        </Label>
                        <Input
                          id={`action-${index}-title`}
                          value={action.title}
                          onChange={(event) =>
                            setActions((current) =>
                              current.map((item, i) =>
                                i === index && item.type === 'CREATE_NOTIFICATION'
                                  ? { ...item, title: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="rb-field">
                        <Label htmlFor={`action-${index}-body`}>Body (optional)</Label>
                        <Textarea
                          id={`action-${index}-body`}
                          rows={2}
                          value={action.body}
                          onChange={(event) =>
                            setActions((current) =>
                              current.map((item, i) =>
                                i === index && item.type === 'CREATE_NOTIFICATION'
                                  ? { ...item, body: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="rb-field">
                        <Label htmlFor={`action-${index}-task-title`}>Task title</Label>
                        <Input
                          id={`action-${index}-task-title`}
                          value={action.title}
                          onChange={(event) =>
                            setActions((current) =>
                              current.map((item, i) =>
                                i === index && item.type === 'CREATE_TASK'
                                  ? { ...item, title: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="rb-field">
                        <Label htmlFor={`action-${index}-task-assignee`}>
                          Assign to (optional)
                        </Label>
                        <Select
                          id={`action-${index}-task-assignee`}
                          value={action.assignedToUserId}
                          onChange={(event) =>
                            setActions((current) =>
                              current.map((item, i) =>
                                i === index && item.type === 'CREATE_TASK'
                                  ? { ...item, assignedToUserId: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="">Unassigned</option>
                          {members.map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.displayName}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </>
                  )}
                </Card>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setActions((current) => [
                    ...current,
                    {
                      type: 'CREATE_NOTIFICATION',
                      recipientUserId: '',
                      title: '',
                      body: '',
                      href: '',
                    },
                  ])
                }
              >
                Add action
              </Button>
            </div>

            <div className="rb-ledger-row-actions">
              <Button
                type="button"
                loading={creating}
                disabled={!name.trim()}
                onClick={() => void submitRule()}
              >
                {editingRuleId ? 'Save changes' : 'Create rule'}
              </Button>
              {editingRuleId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </Card>
        ) : null}

        {rules === null ? <Skeleton /> : null}
        {rules && rules.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No workflow rules yet"
            description="Create one above to notify someone or create a task automatically."
          />
        ) : null}
        {rules && rules.length > 0 ? (
          <DataTable caption="Workflow rules" columns={columns} rows={rules} />
        ) : null}
      </div>
      {detailRuleId && organizationId ? (
        <RuleDetailPanel
          organizationId={organizationId}
          rule={rules?.find((rule) => rule.id === detailRuleId) ?? null}
          onClose={() => setDetailRuleId(null)}
        />
      ) : null}
    </>
  );
}

function RuleDetailPanel({
  organizationId,
  rule,
  onClose,
}: {
  organizationId: string;
  rule: WorkflowRule | null;
  onClose: () => void;
}) {
  const [payloadText, setPayloadText] = useState('{}');
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);

  useEffect(() => {
    if (!rule) return;
    let cancelled = false;
    apiRequest<{ data: WorkflowRun[] }>(
      `/organizations/${organizationId}/automation/workflow-rules/${rule.id}/runs`,
    )
      .then((response) => {
        if (!cancelled) setRuns(response.data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setRunsError(message(caught, 'Run history could not be loaded.'));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, rule]);

  async function runDryRun() {
    if (!rule) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText || '{}') as Record<string, unknown>;
    } catch {
      setDryRunError('That sample payload is not valid JSON.');
      return;
    }
    setTesting(true);
    setDryRunError(null);
    try {
      const response = await apiRequest<{ data: DryRunResult }>(
        `/organizations/${organizationId}/automation/workflow-rules/${rule.id}/dry-run`,
        { method: 'POST', body: JSON.stringify({ payload }) },
      );
      setDryRunResult(response.data);
    } catch (caught) {
      setDryRunError(message(caught, 'The dry run could not be evaluated.'));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title={rule ? `Test & history — ${rule.name}` : 'Test & history'}>
        {rule ? (
          <div className="rb-ledger-stack">
            <div className="rb-field">
              <Label htmlFor="dry-run-payload">
                <FlaskConical aria-hidden="true" /> Sample event payload (JSON)
              </Label>
              <Textarea
                id="dry-run-payload"
                rows={4}
                value={payloadText}
                onChange={(event) => setPayloadText(event.target.value)}
              />
              {dryRunError ? (
                <div className="rb-auth-error" role="alert">
                  {dryRunError}
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={testing}
                onClick={() => void runDryRun()}
              >
                Run test
              </Button>
            </div>
            {dryRunResult ? (
              <Card className="rb-ledger-form-card">
                <p>
                  <Badge tone={dryRunResult.matched ? 'success' : 'danger'}>
                    {dryRunResult.matched ? 'Matches' : 'No match'}
                  </Badge>{' '}
                  {dryRunResult.matched
                    ? 'This payload would fire the rule.'
                    : 'This payload would not fire the rule.'}
                </p>
                {dryRunResult.conditionResults.map((result, index) => (
                  <p key={index}>
                    {result.matched ? '✓' : '✗'} {result.field} {result.operator}{' '}
                    {JSON.stringify(result.value)}
                  </p>
                ))}
              </Card>
            ) : null}

            <div className="rb-field">
              <Label>
                <History aria-hidden="true" /> Recent runs
              </Label>
              {runsError ? (
                <div className="rb-auth-error" role="alert">
                  {runsError}
                </div>
              ) : null}
              {runs === null && !runsError ? <Skeleton /> : null}
              {runs && runs.length === 0 ? <p>This rule has not run yet.</p> : null}
              {runs && runs.length > 0 ? (
                <ol className="rb-timeline">
                  {runs.map((run) => (
                    <li key={run.id} className="rb-timeline__entry">
                      <div className="rb-timeline__head">
                        <StatusBadge status={run.status} />
                        <span>{formatDate(run.createdAt)}</span>
                      </div>
                      {run.error ? <p>{run.error}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </div>
        ) : (
          <Skeleton />
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && trimmed !== '' && !Number.isNaN(numeric) ? numeric : trimmed;
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
