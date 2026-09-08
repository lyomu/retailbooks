'use client';

import type {
  Contact,
  Expense,
  Invoice,
  OrganizationMember,
  Project,
  ProjectBillable,
  ProjectBudget,
  ProjectExpense,
  ProjectProfitability,
  ProjectTask,
  TimeEntry,
} from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  Textarea,
  type DataTableColumn,
} from '@retailbooks/ui';
import {
  Briefcase,
  CircleDollarSign,
  Clock,
  Play,
  Plus,
  Receipt,
  Save,
  Search,
  Square,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Undo2,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { TransactionCollaboration } from './transaction-collaboration';

type ProjectListResponse = { data: Project[] };
type ProjectResponse = { data: Project };
type ProjectTaskListResponse = { data: ProjectTask[] };
type ProjectTaskResponse = { data: ProjectTask };
type ProjectBudgetListResponse = { data: ProjectBudget[] };
type ProjectExpenseListResponse = { data: ProjectExpense[] };
type ProjectBillableListResponse = { data: ProjectBillable[] };
type ProjectProfitabilityResponse = { data: ProjectProfitability };
type TimeEntryListResponse = { data: TimeEntry[] };
type ContactListResponse = { data: Contact[] };
type MemberListResponse = { data: OrganizationMember[] };
type ExpenseListResponse = { data: Expense[] };
type InvoiceResponse = { data: Invoice };

const PROJECT_STATUSES = ['OPEN', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
const BILLING_METHODS = ['TIME_AND_MATERIALS', 'FIXED_PRICE', 'NON_BILLABLE'] as const;
const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const;
const TIME_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'INVOICED'] as const;

/** The two statuses whose time the person who recorded it may still change. */
const EDITABLE_TIME_STATUSES: readonly string[] = ['DRAFT', 'REJECTED'];

// --- Projects register --------------------------------------------------------------------------

export function ProjectsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'projects.view');
  const canManage = hasPermission(organization, 'projects.manage');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = status ? `?status=${status}` : '';
      const [projectResponse, customerResponse, memberResponse] = await Promise.all([
        apiRequest<ProjectListResponse>(`/organizations/${organizationId}/projects${suffix}`),
        apiRequest<ContactListResponse>(`/organizations/${organizationId}/customers?status=ACTIVE`),
        apiRequest<MemberListResponse>(`/organizations/${organizationId}/members`),
      ]);
      setProjects(projectResponse.data);
      setCustomers(customerResponse.data);
      setMembers(memberResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Projects could not be loaded.');
    }
  }, [organizationId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects ?? [];
    return (projects ?? []).filter((project) =>
      `${project.name} ${project.code ?? ''} ${project.customerName ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [projects, query]);

  const columns: readonly DataTableColumn<Project>[] = [
    {
      key: 'project',
      header: 'Project',
      cell: (project) => (
        <div>
          <strong>
            <Link href={`/projects/${project.id}`}>{project.name}</Link>
          </strong>
          <span className="rb-table-secondary">{project.code ?? 'No code'}</span>
        </div>
      ),
    },
    { key: 'customer', header: 'Customer', cell: (project) => project.customerName ?? 'Internal' },
    {
      key: 'manager',
      header: 'Manager',
      cell: (project) => project.managerName ?? 'Unassigned',
      hideBelow: 'tablet',
    },
    {
      key: 'billing',
      header: 'Billing',
      cell: (project) => label(project.billingMethod),
      hideBelow: 'tablet',
    },
    {
      key: 'dates',
      header: 'Dates',
      cell: (project) => `${project.startsOn ?? 'Not set'} to ${project.endsOn ?? 'open'}`,
      hideBelow: 'desktop',
    },
    {
      key: 'budget',
      header: 'Budget',
      align: 'right',
      cell: (project) =>
        project.budgetAmountMinor
          ? formatMinor(project.budgetAmountMinor, project.currency)
          : 'Not set',
    },
    { key: 'status', header: 'Status', cell: (project) => <StatusBadge status={project.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (project) => (
        <div className="rb-ledger-row-actions">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/projects/${project.id}`}>Open</Link>
          </Button>
          {canManage ? (
            <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(project)}>
              Edit
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for project access to see the project register." />;
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Client work with its own budget, tasks, billable time, and margin."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setShowCreate(true)}>
              <Plus aria-hidden="true" /> New project
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {(showCreate || editing) && canManage ? (
          <ProjectForm
            project={editing}
            organizationId={organizationId}
            baseCurrency={organization?.baseCurrency ?? 'KES'}
            customers={customers}
            members={members}
            onCancel={() => {
              setShowCreate(false);
              setEditing(null);
            }}
            onSaved={(project) => {
              setNotice(`${project.name} was saved.`);
              setShowCreate(false);
              setEditing(null);
              void load();
            }}
          />
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="project-search">
              <Search aria-hidden="true" /> Search projects
            </Label>
            <Input
              id="project-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-status-filter">Status</Label>
            <Select
              id="project-status-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {PROJECT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{filtered.length} projects</Badge>
        </Card>
        {!projects && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Projects"
            columns={columns}
            rows={filtered}
            emptyTitle="No projects"
            emptyDescription="Create a project to track its time, expenses, and margin."
          />
        )}
      </div>
    </>
  );
}

function ProjectForm({
  project,
  organizationId,
  baseCurrency,
  customers,
  members,
  onCancel,
  onSaved,
}: {
  project: Project | null;
  organizationId: string | null;
  baseCurrency: string;
  customers: readonly Contact[];
  members: readonly OrganizationMember[];
  onCancel: () => void;
  onSaved: (project: Project) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const budget = formValue(data, 'budgetAmount');
    const rate = formValue(data, 'defaultRate');
    const body = {
      name: formValue(data, 'name'),
      code: formValue(data, 'code') || undefined,
      customerId: formValue(data, 'customerId') || undefined,
      managerUserId: formValue(data, 'managerUserId') || undefined,
      billingMethod: formValue(data, 'billingMethod'),
      currency: formValue(data, 'currency').toUpperCase() || undefined,
      startsOn: formValue(data, 'startsOn') || undefined,
      endsOn: formValue(data, 'endsOn') || undefined,
      budgetAmountMinor: budget ? decimalToMinor(budget) : undefined,
      budgetHours: formValue(data, 'budgetHours') || undefined,
      defaultRateMinor: rate ? decimalToMinor(rate) : undefined,
      description: formValue(data, 'description') || undefined,
    };
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<ProjectResponse>(
        project
          ? `/organizations/${organizationId}/projects/${project.id}`
          : `/organizations/${organizationId}/projects`,
        { method: project ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The project could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <h2>{project ? `Edit ${project.name}` : 'New project'}</h2>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              name="name"
              defaultValue={project?.name ?? ''}
              maxLength={160}
              required
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-code">Code</Label>
            <Input
              id="project-code"
              name="code"
              defaultValue={project?.code ?? ''}
              maxLength={40}
              placeholder="Optional short reference"
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-customer">Customer</Label>
            <Select
              id="project-customer"
              name="customerId"
              defaultValue={project?.customerId ?? ''}
            >
              <option value="">Internal (no customer)</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="project-manager">Manager</Label>
            <Select
              id="project-manager"
              name="managerUserId"
              defaultValue={project?.managerUserId ?? ''}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="project-billing">Billing method</Label>
            <Select
              id="project-billing"
              name="billingMethod"
              defaultValue={project?.billingMethod ?? 'TIME_AND_MATERIALS'}
            >
              {BILLING_METHODS.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="project-currency">Currency</Label>
            <Input
              id="project-currency"
              name="currency"
              defaultValue={project?.currency ?? baseCurrency}
              maxLength={3}
              minLength={3}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-starts">Starts on</Label>
            <Input
              id="project-starts"
              name="startsOn"
              type="date"
              defaultValue={project?.startsOn ?? ''}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-ends">Ends on</Label>
            <Input
              id="project-ends"
              name="endsOn"
              type="date"
              defaultValue={project?.endsOn ?? ''}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-budget-amount">Budget amount</Label>
            <Input
              id="project-budget-amount"
              name="budgetAmount"
              inputMode="decimal"
              defaultValue={minorToDecimal(project?.budgetAmountMinor ?? null)}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-budget-hours">Budget hours</Label>
            <Input
              id="project-budget-hours"
              name="budgetHours"
              inputMode="decimal"
              defaultValue={project?.budgetHours ?? ''}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-rate">Default hourly rate</Label>
            <Input
              id="project-rate"
              name="defaultRate"
              inputMode="decimal"
              defaultValue={minorToDecimal(project?.defaultRateMinor ?? null)}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              name="description"
              defaultValue={project?.description ?? ''}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>
        <div className="rb-dialog-footer">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> Save project
          </Button>
        </div>
      </form>
    </Card>
  );
}

// --- Project detail -----------------------------------------------------------------------------

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'projects.view');
  const canManage = hasPermission(organization, 'projects.manage');
  const canSeeMargin = hasPermission(organization, 'projects.profitability.view');
  const [project, setProject] = useState<Project | null>(null);
  const [profitability, setProfitability] = useState<ProjectProfitability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<ProjectResponse>(
        `/organizations/${organizationId}/projects/${projectId}`,
      );
      setProject(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The project could not be loaded.');
    }
    if (!canSeeMargin) return;
    try {
      const response = await apiRequest<ProjectProfitabilityResponse>(
        `/organizations/${organizationId}/projects/${projectId}/profitability`,
      );
      setProfitability(response.data);
    } catch {
      // Profitability is a panel on this page, not the page itself: a failure here should not
      // replace the project the user asked for with an error state.
      setProfitability(null);
    }
  }, [canSeeMargin, organizationId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(status: string) {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/projects/${projectId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      setNotice(`Project moved to ${label(status)}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The status could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for project access to open this project." />;
  }

  if (!project) {
    return (
      <div className="rb-ledger-stack">
        <Messages error={error} />
        {!error ? <Skeleton /> : null}
      </div>
    );
  }

  const nextStatuses = PROJECT_STATUSES.filter((status) => status !== project.status);

  return (
    <>
      <PageHeader
        title={project.name}
        description={`${project.code ? `${project.code} · ` : ''}${
          project.customerName ?? 'Internal'
        } · ${label(project.billingMethod)} · ${project.currency}`}
        actions={
          canManage ? (
            <div className="rb-ledger-row-actions">
              {nextStatuses.map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void changeStatus(status)}
                >
                  {label(status)}
                </Button>
              ))}
            </div>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        <Card className="rb-ledger-toolbar">
          <StatusBadge status={project.status} />
          <Badge tone="info">
            {project.budgetHours ? `${project.budgetHours} budgeted hours` : 'No hour budget'}
          </Badge>
          <Badge tone="info">
            {project.budgetAmountMinor
              ? `${formatMinor(project.budgetAmountMinor, project.currency)} budget`
              : 'No amount budget'}
          </Badge>
          <Badge>
            {project.defaultRateMinor
              ? `${formatMinor(project.defaultRateMinor, project.currency)} per hour`
              : 'No default rate'}
          </Badge>
        </Card>
        {canSeeMargin ? (
          <ProfitabilityPanel profitability={profitability} project={project} />
        ) : null}
        <TasksSection organizationId={organizationId} project={project} canManage={canManage} />
        <BudgetsSection organizationId={organizationId} project={project} canManage={canManage} />
        <ProjectTimeSection organizationId={organizationId} project={project} />
        <ProjectExpensesSection
          organizationId={organizationId}
          project={project}
          canManage={hasPermission(organization, 'projects.expenses.manage')}
        />
        <BillingSection
          organizationId={organizationId}
          project={project}
          canBill={hasPermission(organization, 'projects.billing.manage')}
          onBilled={() => void load()}
        />
        {organizationId && projectId ? (
          <TransactionCollaboration
            organizationId={organizationId}
            targetType="PROJECT"
            targetId={projectId}
            canComment={hasPermission(organization, 'collaboration.comments.create')}
            canUpload={
              hasPermission(organization, 'collaboration.attachments.upload') &&
              hasPermission(organization, 'projects.manage')
            }
          />
        ) : null}
      </div>
    </>
  );
}

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="rb-panel-heading">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ?? null}
      </div>
      <div className="rb-ledger-stack">{children}</div>
    </Card>
  );
}

function ProfitabilityPanel({
  profitability,
  project,
}: {
  profitability: ProjectProfitability | null;
  project: Project;
}) {
  if (!profitability) {
    return (
      <Section
        title="Profitability"
        description="Revenue and cost read from posted journal lines carrying this project."
      >
        <Skeleton />
      </Section>
    );
  }

  const currency = profitability.currency;
  const marginTone = BigInt(profitability.marginMinor) < 0n ? 'danger' : 'success';

  return (
    <Section
      title="Profitability"
      description="Revenue and cost come from posted journal lines carrying this project, so they tie to the profit and loss. Unbilled figures are pipeline, not ledger."
    >
      <div className="rb-dashboard-stats">
        <StatCard
          label="Revenue"
          value={formatMinor(profitability.revenueMinor, currency)}
          icon={TrendingUp}
          tone="info"
          hint="Posted revenue lines"
        />
        <StatCard
          label="Cost"
          value={formatMinor(profitability.costMinor, currency)}
          icon={Wallet}
          tone="warning"
          hint="Posted expense lines"
        />
        <StatCard
          label="Margin"
          value={formatMinor(profitability.marginMinor, currency)}
          icon={CircleDollarSign}
          tone={marginTone}
          hint={
            profitability.marginPercent
              ? `${profitability.marginPercent}% of revenue`
              : 'No revenue yet'
          }
        />
        <StatCard
          label="Unbilled"
          value={formatMinor(
            (
              BigInt(profitability.unbilledTimeMinor) + BigInt(profitability.unbilledExpenseMinor)
            ).toString(),
            currency,
          )}
          icon={Clock}
          tone="primary"
          hint={`${profitability.unbilledHours} hours awaiting billing`}
        />
      </div>
      <Card className="rb-ledger-toolbar">
        <Badge>{profitability.billedHours} hours billed</Badge>
        <Badge tone="warning">{profitability.unbilledHours} hours unbilled</Badge>
        <Badge tone="info">
          {formatMinor(profitability.unbilledTimeMinor, currency)} unbilled time
        </Badge>
        <Badge tone="info">
          {formatMinor(profitability.unbilledExpenseMinor, currency)} unbilled expenses
        </Badge>
        {project.budgetAmountMinor ? (
          <Badge tone="neutral">{formatMinor(project.budgetAmountMinor, currency)} budget</Badge>
        ) : null}
      </Card>
    </Section>
  );
}

function TasksSection({
  organizationId,
  project,
  canManage,
}: {
  organizationId: string | null;
  project: Project;
  canManage: boolean;
}) {
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null);
  const [editing, setEditing] = useState<ProjectTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [taskResponse, memberResponse] = await Promise.all([
        apiRequest<ProjectTaskListResponse>(
          `/organizations/${organizationId}/projects/${project.id}/tasks`,
        ),
        apiRequest<MemberListResponse>(`/organizations/${organizationId}/members`),
      ]);
      setTasks(taskResponse.data);
      setMembers(memberResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tasks could not be loaded.');
    }
  }, [organizationId, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: readonly DataTableColumn<ProjectTask>[] = [
    { key: 'name', header: 'Task', cell: (task) => <strong>{task.name}</strong> },
    {
      key: 'assignee',
      header: 'Assignee',
      cell: (task) => task.assigneeName ?? 'Unassigned',
    },
    { key: 'status', header: 'Status', cell: (task) => <StatusBadge status={task.status} /> },
    {
      key: 'estimate',
      header: 'Estimate',
      align: 'right',
      cell: (task) => (task.estimateHours ? `${task.estimateHours} h` : 'Not set'),
    },
    {
      key: 'rate',
      header: 'Rate',
      align: 'right',
      cell: (task) =>
        task.rateMinor ? formatMinor(task.rateMinor, project.currency) : 'Project default',
      hideBelow: 'tablet',
    },
    {
      key: 'billable',
      header: 'Billable',
      cell: (task) => (task.billableDefault ? 'Yes' : 'No'),
      hideBelow: 'tablet',
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (task) =>
        canManage ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(task)}>
            Edit
          </Button>
        ) : null,
    },
  ];

  return (
    <Section
      title="Tasks"
      description="Tasks inherit the project's access; time and budgets hang off them."
      actions={
        canManage ? (
          <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
            <Plus aria-hidden="true" /> Add task
          </Button>
        ) : null
      }
    >
      <Messages error={error} />
      {(showCreate || editing) && canManage ? (
        <TaskForm
          task={editing}
          project={project}
          organizationId={organizationId}
          members={members}
          onCancel={() => {
            setShowCreate(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowCreate(false);
            setEditing(null);
            void load();
          }}
        />
      ) : null}
      {!tasks && !error ? (
        <Skeleton />
      ) : (
        <DataTable
          caption="Project tasks"
          columns={columns}
          rows={tasks ?? []}
          emptyTitle="No tasks"
          emptyDescription="Add a task to estimate and budget the work."
        />
      )}
    </Section>
  );
}

function TaskForm({
  task,
  project,
  organizationId,
  members,
  onCancel,
  onSaved,
}: {
  task: ProjectTask | null;
  project: Project;
  organizationId: string | null;
  members: readonly OrganizationMember[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const rate = formValue(data, 'rate');
    const body = {
      name: formValue(data, 'name'),
      assigneeUserId: formValue(data, 'assigneeUserId') || undefined,
      status: formValue(data, 'status'),
      estimateHours: formValue(data, 'estimateHours') || undefined,
      billableDefault: formValue(data, 'billableDefault') === 'true',
      rateMinor: rate ? decimalToMinor(rate) : undefined,
    };
    setSaving(true);
    setError(null);
    try {
      await apiRequest<ProjectTaskResponse>(
        task
          ? `/organizations/${organizationId}/projects/tasks/${task.id}`
          : `/organizations/${organizationId}/projects/${project.id}/tasks`,
        { method: task ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The task could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <h2>{task ? `Edit ${task.name}` : 'Add task'}</h2>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="task-name">Name</Label>
            <Input
              id="task-name"
              name="name"
              defaultValue={task?.name ?? ''}
              maxLength={160}
              required
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="task-assignee">Assignee</Label>
            <Select
              id="task-assignee"
              name="assigneeUserId"
              defaultValue={task?.assigneeUserId ?? ''}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="task-status">Status</Label>
            <Select id="task-status" name="status" defaultValue={task?.status ?? 'OPEN'}>
              {TASK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="task-estimate">Estimate hours</Label>
            <Input
              id="task-estimate"
              name="estimateHours"
              inputMode="decimal"
              defaultValue={task?.estimateHours ?? ''}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="task-rate">Hourly rate</Label>
            <Input
              id="task-rate"
              name="rate"
              inputMode="decimal"
              defaultValue={minorToDecimal(task?.rateMinor ?? null)}
              placeholder={minorToDecimal(project.defaultRateMinor ?? null) || 'Project default'}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="task-billable">Billable by default</Label>
            <Select
              id="task-billable"
              name="billableDefault"
              defaultValue={task ? String(task.billableDefault) : 'true'}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </div>
        </div>
        <div className="rb-dialog-footer">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> Save task
          </Button>
        </div>
      </form>
    </Card>
  );
}

function BudgetsSection({
  organizationId,
  project,
  canManage,
}: {
  organizationId: string | null;
  project: Project;
  canManage: boolean;
}) {
  const [budgets, setBudgets] = useState<ProjectBudget[] | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [budgetResponse, taskResponse] = await Promise.all([
        apiRequest<ProjectBudgetListResponse>(
          `/organizations/${organizationId}/projects/${project.id}/budgets`,
        ),
        apiRequest<ProjectTaskListResponse>(
          `/organizations/${organizationId}/projects/${project.id}/tasks`,
        ),
      ]);
      setBudgets(budgetResponse.data);
      setTasks(taskResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Budgets could not be loaded.');
    }
  }, [organizationId, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const amount = formValue(data, 'budgetAmount');
    const body = {
      taskId: formValue(data, 'taskId'),
      budgetHours: formValue(data, 'budgetHours') || undefined,
      budgetAmountMinor: amount ? decimalToMinor(amount) : undefined,
      note: formValue(data, 'note') || undefined,
    };
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/projects/${project.id}/budgets`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The budget could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const columns: readonly DataTableColumn<ProjectBudget>[] = [
    { key: 'task', header: 'Task', cell: (budget) => <strong>{budget.taskName}</strong> },
    {
      key: 'hours',
      header: 'Budget hours',
      align: 'right',
      cell: (budget) => (budget.budgetHours ? `${budget.budgetHours} h` : 'Not set'),
    },
    {
      key: 'amount',
      header: 'Budget amount',
      align: 'right',
      cell: (budget) =>
        budget.budgetAmountMinor
          ? formatMinor(budget.budgetAmountMinor, project.currency)
          : 'Not set',
    },
    { key: 'note', header: 'Note', cell: (budget) => budget.note ?? '', hideBelow: 'tablet' },
  ];

  return (
    <Section
      title="Budgets"
      description="Per-task allocation beneath the project's own totals. One row per task; saving the same task again replaces its row."
      actions={
        canManage ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setShowForm(true)}
            disabled={tasks.length === 0}
          >
            <Plus aria-hidden="true" /> Set budget
          </Button>
        ) : null
      }
    >
      <Messages error={error} />
      {showForm && canManage ? (
        <Card className="rb-ledger-form-card">
          <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
            <div className="rb-ledger-form__heading">
              <h2>Set task budget</h2>
            </div>
            <div className="rb-field-grid">
              <div className="rb-field">
                <Label htmlFor="budget-task">Task</Label>
                <Select id="budget-task" name="taskId" required>
                  <option value="">Choose task</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="budget-hours">Budget hours</Label>
                <Input id="budget-hours" name="budgetHours" inputMode="decimal" />
              </div>
              <div className="rb-field">
                <Label htmlFor="budget-amount">Budget amount</Label>
                <Input id="budget-amount" name="budgetAmount" inputMode="decimal" />
              </div>
              <div className="rb-field">
                <Label htmlFor="budget-note">Note</Label>
                <Input id="budget-note" name="note" maxLength={240} />
              </div>
            </div>
            <div className="rb-dialog-footer">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                <Save aria-hidden="true" /> Save budget
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {!budgets && !error ? (
        <Skeleton />
      ) : (
        <DataTable
          caption="Task budgets"
          columns={columns}
          rows={budgets ?? []}
          emptyTitle="No task budgets"
          emptyDescription="Budget a task to track burn against it."
        />
      )}
    </Section>
  );
}

function ProjectTimeSection({
  organizationId,
  project,
}: {
  organizationId: string | null;
  project: Project;
}) {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<TimeEntryListResponse>(
      `/organizations/${organizationId}/projects/time-entries?projectId=${project.id}`,
    )
      .then((response) => {
        setEntries(response.data);
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Time could not be loaded.');
      });
  }, [organizationId, project.id]);

  return (
    <Section
      title="Time"
      description="Every hour recorded against this project, whoever recorded it."
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href="/timesheets">Open timesheet</Link>
        </Button>
      }
    >
      <Messages error={error} />
      {!entries && !error ? (
        <Skeleton />
      ) : (
        <DataTable
          caption="Project time"
          columns={timeColumns(project.currency)}
          rows={entries ?? []}
          emptyTitle="No time recorded"
          emptyDescription="Recorded hours appear here once someone logs them."
        />
      )}
    </Section>
  );
}

function ProjectExpensesSection({
  organizationId,
  project,
  canManage,
}: {
  organizationId: string | null;
  project: Project;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<ProjectExpense[] | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<ProjectExpenseListResponse>(
        `/organizations/${organizationId}/projects/${project.id}/expenses`,
      );
      setRows(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Project expenses could not be loaded.');
    }
    if (!canManage) return;
    try {
      const response = await apiRequest<ExpenseListResponse>(
        `/organizations/${organizationId}/expenses`,
      );
      setExpenses(response.data);
    } catch {
      setExpenses([]);
    }
  }, [canManage, organizationId, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const body = {
      expenseId: formValue(data, 'expenseId'),
      billable: formValue(data, 'billable') === 'true',
      markupPercent: formValue(data, 'markupPercent') || undefined,
    };
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/projects/${project.id}/expenses`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNotice('The expense is now part of this project.');
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The expense could not be linked.');
    } finally {
      setSaving(false);
    }
  }

  async function unlink(row: ProjectExpense) {
    if (!organizationId) return;
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/projects/expenses/${row.id}`, {
        method: 'DELETE',
      });
      setNotice('The expense was removed from this project.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The expense could not be removed.');
    }
  }

  const linkedExpenseIds = new Set((rows ?? []).map((row) => row.expenseId));
  const linkable = expenses.filter((expense) => !linkedExpenseIds.has(expense.id));

  const columns: readonly DataTableColumn<ProjectExpense>[] = [
    {
      key: 'expense',
      header: 'Expense',
      cell: (row) => (
        <div>
          <strong>{row.expenseNumber ?? 'Unnumbered'}</strong>
          <span className="rb-table-secondary">{row.payeeName ?? 'No payee'}</span>
        </div>
      ),
    },
    { key: 'date', header: 'Date', cell: (row) => row.expenseDate },
    {
      key: 'amount',
      header: 'Cost',
      align: 'right',
      cell: (row) => formatMinor(row.amountMinor, project.currency),
    },
    {
      key: 'markup',
      header: 'Markup',
      align: 'right',
      cell: (row) => (row.markupPercent ? `${row.markupPercent}%` : 'None'),
      hideBelow: 'tablet',
    },
    {
      key: 'billable',
      header: 'Rebill',
      align: 'right',
      cell: (row) =>
        row.billable ? formatMinor(row.billableAmountMinor, project.currency) : 'Not billable',
    },
    {
      key: 'invoiced',
      header: 'Invoiced',
      cell: (row) =>
        row.invoiceLineId ? <Badge tone="success">Invoiced</Badge> : <Badge>Open</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) =>
        canManage && !row.invoiceLineId ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => void unlink(row)}>
            Remove
          </Button>
        ) : null,
    },
  ];

  return (
    <Section
      title="Expenses"
      description="Spend attributed to this project. An invoiced expense can never be billed a second time."
      actions={
        canManage ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setShowForm(true)}
            disabled={linkable.length === 0}
          >
            <Plus aria-hidden="true" /> Add expense
          </Button>
        ) : null
      }
    >
      <Messages error={error} notice={notice} />
      {showForm && canManage ? (
        <Card className="rb-ledger-form-card">
          <form className="rb-ledger-form" onSubmit={(event) => void link(event)}>
            <div className="rb-ledger-form__heading">
              <h2>Attribute an expense to this project</h2>
            </div>
            <div className="rb-field-grid">
              <div className="rb-field">
                <Label htmlFor="project-expense">Expense</Label>
                <Select id="project-expense" name="expenseId" required>
                  <option value="">Choose expense</option>
                  {linkable.map((expense) => (
                    <option key={expense.id} value={expense.id}>
                      {expense.expenseNumber ?? expense.expenseDate} ·{' '}
                      {expense.payeeName ?? expense.payeeVendorName ?? 'No payee'} ·{' '}
                      {formatMinor(expense.totalMinor, expense.currency)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="project-expense-billable">Billable</Label>
                <Select id="project-expense-billable" name="billable" defaultValue="true">
                  <option value="true">Rebill to the customer</option>
                  <option value="false">Absorb as project cost</option>
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="project-expense-markup">Markup percent</Label>
                <Input
                  id="project-expense-markup"
                  name="markupPercent"
                  inputMode="decimal"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="rb-dialog-footer">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                <Save aria-hidden="true" /> Attribute expense
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {!rows && !error ? (
        <Skeleton />
      ) : (
        <DataTable
          caption="Project expenses"
          columns={columns}
          rows={rows ?? []}
          emptyTitle="No project expenses"
          emptyDescription="Attribute a recorded expense to make it part of this project's cost."
        />
      )}
    </Section>
  );
}

type BillableRow = ProjectBillable & { id: string };

function BillingSection({
  organizationId,
  project,
  canBill,
  onBilled,
}: {
  organizationId: string | null;
  project: Project;
  canBill: boolean;
  onBilled: () => void;
}) {
  const [billables, setBillables] = useState<BillableRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issue, setIssue] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !canBill) return;
    try {
      const response = await apiRequest<ProjectBillableListResponse>(
        `/organizations/${organizationId}/projects/${project.id}/billables`,
      );
      const rows = response.data.map((row) => ({ ...row, id: row.sourceId }));
      setBillables(rows);
      setSelected(new Set(rows.map((row) => row.id)));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Billable work could not be loaded.');
    }
  }, [canBill, organizationId, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(
    () =>
      (billables ?? [])
        .filter((row) => selected.has(row.id))
        .reduce((sum, row) => sum + BigInt(row.lineTotalMinor), 0n)
        .toString(),
    [billables, selected],
  );

  async function generate() {
    if (!organizationId) return;
    const chosen = (billables ?? []).filter((row) => selected.has(row.id));
    if (chosen.length === 0) {
      setError('Choose at least one line to bill.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/projects/${project.id}/generate-invoice`,
        {
          method: 'POST',
          // The endpoint is idempotent on this header: a retried click returns the invoice the
          // first attempt created rather than billing the same work twice.
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            timeEntryIds: chosen.filter((row) => row.sourceType === 'TIME').map((row) => row.id),
            projectExpenseIds: chosen
              .filter((row) => row.sourceType === 'EXPENSE')
              .map((row) => row.id),
            dueDate: dueDate || undefined,
            issue,
          }),
        },
      );
      setNotice(
        `Invoice ${response.data.invoiceNumber ?? 'draft'} was created for ${formatMinor(
          response.data.totalMinor,
          response.data.currency,
        )}.`,
      );
      await load();
      onBilled();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invoice could not be generated.');
    } finally {
      setBusy(false);
    }
  }

  const columns: readonly DataTableColumn<BillableRow>[] = [
    {
      key: 'select',
      header: 'Bill',
      width: '4rem',
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={`Include ${row.description}`}
          checked={selected.has(row.id)}
          onChange={(event) => {
            setSelected((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(row.id);
              else next.delete(row.id);
              return next;
            });
          }}
        />
      ),
    },
    {
      key: 'source',
      header: 'Source',
      cell: (row) => (
        <Badge tone={row.sourceType === 'TIME' ? 'info' : 'neutral'}>{label(row.sourceType)}</Badge>
      ),
    },
    { key: 'description', header: 'Description', cell: (row) => row.description },
    { key: 'quantity', header: 'Qty', align: 'right', cell: (row) => row.quantity },
    {
      key: 'unit',
      header: 'Unit price',
      align: 'right',
      cell: (row) => formatMinor(row.unitPriceMinor, project.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'total',
      header: 'Amount',
      align: 'right',
      cell: (row) => formatMinor(row.lineTotalMinor, project.currency),
    },
  ];

  if (!canBill) {
    return (
      <Section
        title="Billing"
        description="Turn approved time and billable expenses into an invoice."
      >
        <ForbiddenState
          title="Billing is restricted"
          description="Ask for project billing access to invoice this work."
        />
      </Section>
    );
  }

  return (
    <Section
      title="Billing"
      description="Approved unbilled time and billable expenses, invoiced through the normal sales path so tax, numbering, and posting all behave the same."
      actions={
        <Button type="button" size="sm" loading={busy} onClick={() => void generate()}>
          <Receipt aria-hidden="true" /> Generate invoice
        </Button>
      }
    >
      <Messages error={error} notice={notice} />
      <Card className="rb-ledger-toolbar">
        <div className="rb-field">
          <Label htmlFor="billing-due">Due date</Label>
          <Input
            id="billing-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
        <div className="rb-field">
          <Label htmlFor="billing-issue">On creation</Label>
          <Select
            id="billing-issue"
            value={issue ? 'true' : 'false'}
            onChange={(event) => setIssue(event.target.value === 'true')}
          >
            <option value="true">Issue and post it</option>
            <option value="false">Leave it as a draft</option>
          </Select>
        </div>
        <Badge tone="info">{formatMinor(total, project.currency)} selected</Badge>
      </Card>
      {!billables && !error ? (
        <Skeleton />
      ) : (
        <DataTable
          caption="Billable work"
          columns={columns}
          rows={billables ?? []}
          emptyTitle="Nothing to bill"
          emptyDescription="Approved billable time and billable expenses appear here."
        />
      )}
    </Section>
  );
}

// --- Timesheet ----------------------------------------------------------------------------------

const TIMER_STORAGE_KEY = 'retailbooks.timer';

export function TimesheetPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'projects.time.view');
  const canManage = hasPermission(organization, 'projects.time.manage');
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(true);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const userId = workspace.user?.id ?? null;

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (status) params.set('status', status);
      if (mine && userId) params.set('userId', userId);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const [entryResponse, projectResponse] = await Promise.all([
        apiRequest<TimeEntryListResponse>(
          `/organizations/${organizationId}/projects/time-entries${suffix}`,
        ),
        apiRequest<ProjectListResponse>(`/organizations/${organizationId}/projects?status=OPEN`),
      ]);
      setEntries(entryResponse.data);
      setProjects(projectResponse.data);
      setSelected(new Set());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Time entries could not be loaded.');
    }
  }, [mine, organizationId, projectId, status, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submittable = useMemo(
    () => (entries ?? []).filter((entry) => EDITABLE_TIME_STATUSES.includes(entry.status)),
    [entries],
  );

  async function submitSelected() {
    if (!organizationId || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/projects/time-entries/submit`, {
        method: 'POST',
        body: JSON.stringify({ timeEntryIds: [...selected] }),
      });
      setNotice(`${selected.size} entries submitted for approval.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The time could not be submitted.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: TimeEntry) {
    if (!organizationId) return;
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/projects/time-entries/${entry.id}`, {
        method: 'DELETE',
      });
      setNotice('The entry was deleted.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The entry could not be deleted.');
    }
  }

  const columns: readonly DataTableColumn<TimeEntry>[] = [
    {
      key: 'select',
      header: 'Submit',
      width: '5rem',
      cell: (entry) =>
        canManage && EDITABLE_TIME_STATUSES.includes(entry.status) ? (
          <input
            type="checkbox"
            aria-label={`Select ${entry.entryDate} on ${entry.projectName}`}
            checked={selected.has(entry.id)}
            onChange={(event) => {
              setSelected((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(entry.id);
                else next.delete(entry.id);
                return next;
              });
            }}
          />
        ) : null,
    },
    ...timeColumns(organization?.baseCurrency ?? 'KES'),
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (entry) =>
        canManage && EDITABLE_TIME_STATUSES.includes(entry.status) ? (
          <div className="rb-ledger-row-actions">
            <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(entry)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={() => void remove(entry)}>
              Delete
            </Button>
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for time access to record and review hours." />;
  }

  return (
    <>
      <PageHeader
        title="Timesheet"
        description="Record hours with the timer or by hand. Submitted time is locked until it is approved, rejected, or unlocked."
        actions={
          canManage && submittable.length > 0 ? (
            <Button
              type="button"
              loading={busy}
              disabled={selected.size === 0}
              onClick={() => void submitSelected()}
            >
              <ThumbsUp aria-hidden="true" /> Submit {selected.size || ''} for approval
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {canManage ? (
          <TimeEntryForm
            entry={editing}
            organizationId={organizationId}
            projects={projects}
            tasks={tasks}
            onTasksNeeded={setTasks}
            onCancelEdit={() => setEditing(null)}
            onSaved={(message) => {
              setNotice(message);
              setEditing(null);
              void load();
            }}
          />
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="time-project-filter">Project</Label>
            <Select
              id="time-project-filter"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="time-status-filter">Status</Label>
            <Select
              id="time-status-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {TIME_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="time-owner-filter">Whose time</Label>
            <Select
              id="time-owner-filter"
              value={mine ? 'mine' : 'everyone'}
              onChange={(event) => setMine(event.target.value === 'mine')}
            >
              <option value="mine">Mine</option>
              <option value="everyone">Everyone</option>
            </Select>
          </div>
          <Badge>{(entries ?? []).length} entries</Badge>
          <Badge tone="info">{totalHours(entries ?? [])} hours</Badge>
        </Card>
        {!entries && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Time entries"
            columns={columns}
            rows={entries ?? []}
            emptyTitle="No time recorded"
            emptyDescription="Start the timer or add an entry by hand."
          />
        )}
      </div>
    </>
  );
}

function TimeEntryForm({
  entry,
  organizationId,
  projects,
  tasks,
  onTasksNeeded,
  onCancelEdit,
  onSaved,
}: {
  entry: TimeEntry | null;
  organizationId: string | null;
  projects: readonly Project[];
  tasks: readonly ProjectTask[];
  onTasksNeeded: (tasks: ProjectTask[]) => void;
  onCancelEdit: () => void;
  onSaved: (message: string) => void;
}) {
  const [projectId, setProjectId] = useState(entry?.projectId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useTimer();

  useEffect(() => {
    setProjectId(entry?.projectId ?? '');
  }, [entry]);

  useEffect(() => {
    if (!organizationId || !projectId) {
      onTasksNeeded([]);
      return;
    }
    apiRequest<ProjectTaskListResponse>(
      `/organizations/${organizationId}/projects/${projectId}/tasks`,
    )
      .then((response) => onTasksNeeded(response.data))
      .catch(() => onTasksNeeded([]));
  }, [onTasksNeeded, organizationId, projectId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const rate = formValue(data, 'rate');
    const body = {
      ...(entry ? {} : { projectId: formValue(data, 'projectId') }),
      taskId: formValue(data, 'taskId') || undefined,
      entryDate: formValue(data, 'entryDate'),
      hours: formValue(data, 'hours'),
      billable: formValue(data, 'billable') === 'true',
      rateMinor: rate ? decimalToMinor(rate) : undefined,
      note: formValue(data, 'note') || undefined,
    };
    setSaving(true);
    setError(null);
    try {
      await apiRequest(
        entry
          ? `/organizations/${organizationId}/projects/time-entries/${entry.id}`
          : `/organizations/${organizationId}/projects/time-entries`,
        { method: entry ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      timer.reset();
      onSaved(entry ? 'The entry was updated.' : 'The hours were recorded.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The entry could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <h2>{entry ? 'Edit time entry' : 'Record time'}</h2>
          <div className="rb-ledger-row-actions">
            <Badge tone={timer.running ? 'success' : 'neutral'}>{timer.display}</Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={timer.running ? timer.stop : timer.start}
            >
              {timer.running ? (
                <>
                  <Square aria-hidden="true" /> Stop timer
                </>
              ) : (
                <>
                  <Play aria-hidden="true" /> Start timer
                </>
              )}
            </Button>
          </div>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="time-project">Project</Label>
            <Select
              id="time-project"
              name="projectId"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={Boolean(entry)}
              required
            >
              <option value="">Choose project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
              {entry && !projects.some((project) => project.id === entry.projectId) ? (
                <option value={entry.projectId}>{entry.projectName}</option>
              ) : null}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="time-task">Task</Label>
            <Select id="time-task" name="taskId" defaultValue={entry?.taskId ?? ''}>
              <option value="">No task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="time-date">Date</Label>
            <Input
              id="time-date"
              name="entryDate"
              type="date"
              defaultValue={entry?.entryDate ?? today()}
              required
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="time-hours">Hours</Label>
            <Input
              id="time-hours"
              name="hours"
              inputMode="decimal"
              defaultValue={entry?.hours ?? timer.hours}
              key={`hours-${entry?.id ?? 'new'}-${timer.hours}`}
              required
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="time-billable">Billable</Label>
            <Select
              id="time-billable"
              name="billable"
              defaultValue={entry ? String(entry.billable) : 'true'}
            >
              <option value="true">Billable</option>
              <option value="false">Non-billable</option>
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="time-rate">Rate override</Label>
            <Input
              id="time-rate"
              name="rate"
              inputMode="decimal"
              defaultValue={minorToDecimal(entry?.rateMinor ?? null)}
              placeholder="Task or project rate"
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="time-note">Note</Label>
            <Textarea
              id="time-note"
              name="note"
              defaultValue={entry?.note ?? ''}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>
        <div className="rb-dialog-footer">
          {entry ? (
            <Button type="button" variant="outline" onClick={onCancelEdit}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> {entry ? 'Save entry' : 'Record time'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * A running stopwatch whose start instant lives in `localStorage`, so a reload or a trip to another
 * screen does not silently discard time someone is in the middle of tracking. It is per-browser
 * only -- nothing about it reaches the server until the entry is saved.
 */
function useTimer() {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hours, setHours] = useState('');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TIMER_STORAGE_KEY);
      if (stored) setStartedAt(Number.parseInt(stored, 10) || null);
    } catch {
      // Private windows and blocked site data both throw here; a timer that cannot persist is
      // still a working timer for this page view.
    }
  }, []);

  useEffect(() => {
    if (startedAt === null) return;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [startedAt]);

  const elapsedMs = startedAt === null ? 0 : Math.max(0, now - startedAt);

  const start = useCallback(() => {
    const at = Date.now();
    setStartedAt(at);
    setNow(at);
    try {
      window.localStorage.setItem(TIMER_STORAGE_KEY, String(at));
    } catch {
      // See above: persistence is a convenience, not the feature.
    }
  }, []);

  const clear = useCallback(() => {
    setStartedAt(null);
    try {
      window.localStorage.removeItem(TIMER_STORAGE_KEY);
    } catch {
      // See above.
    }
  }, []);

  const stop = useCallback(() => {
    const elapsed = startedAt === null ? 0 : Math.max(0, Date.now() - startedAt);
    // Round up to a hundredth of an hour: `TimeEntry.hours` has two decimal places and the service
    // rejects zero, so a 20-second stint becomes 0.01 rather than an error.
    const hundredths = Math.max(1, Math.ceil(elapsed / 36_000));
    setHours((hundredths / 100).toFixed(2));
    clear();
  }, [clear, startedAt]);

  const reset = useCallback(() => {
    setHours('');
    clear();
  }, [clear]);

  return {
    running: startedAt !== null,
    display: startedAt === null ? 'Timer stopped' : formatElapsed(elapsedMs),
    hours,
    start,
    stop,
    reset,
  };
}

// --- Time approvals -----------------------------------------------------------------------------

export function TimeApprovalPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'projects.time.view');
  const canApprove = hasPermission(organization, 'projects.time.approve');
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState('SUBMITTED');
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [comment, setComment] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (projectId) params.set('projectId', projectId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const [entryResponse, projectResponse] = await Promise.all([
        apiRequest<TimeEntryListResponse>(
          `/organizations/${organizationId}/projects/time-entries${suffix}`,
        ),
        apiRequest<ProjectListResponse>(`/organizations/${organizationId}/projects`),
      ]);
      setEntries(entryResponse.data);
      setProjects(projectResponse.data);
      setSelected(new Set());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Time entries could not be loaded.');
    }
  }, [from, organizationId, projectId, status, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: 'approve' | 'reject' | 'unlock') {
    if (!organizationId || selected.size === 0) return;
    if (action === 'reject' && !comment.trim()) {
      setError('Say why the time is being rejected so the person can fix it.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/projects/time-entries/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          timeEntryIds: [...selected],
          comment: comment.trim() || undefined,
        }),
      });
      setNotice(`${selected.size} entries ${action === 'unlock' ? 'unlocked' : `${action}d`}.`);
      setComment('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  const actionable = useMemo(() => {
    const rows = entries ?? [];
    if (status === 'APPROVED') return rows.filter((entry) => !entry.invoiceLineId);
    return rows.filter((entry) => entry.status === 'SUBMITTED');
  }, [entries, status]);

  const columns: readonly DataTableColumn<TimeEntry>[] = [
    {
      key: 'select',
      header: 'Pick',
      width: '4rem',
      cell: (entry) =>
        canApprove && actionable.some((row) => row.id === entry.id) ? (
          <input
            type="checkbox"
            aria-label={`Select ${entry.userName} on ${entry.entryDate}`}
            checked={selected.has(entry.id)}
            onChange={(event) => {
              setSelected((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(entry.id);
                else next.delete(entry.id);
                return next;
              });
            }}
          />
        ) : null,
    },
    { key: 'person', header: 'Person', cell: (entry) => <strong>{entry.userName}</strong> },
    ...timeColumns(organization?.baseCurrency ?? 'KES'),
    {
      key: 'comment',
      header: 'Decision note',
      cell: (entry) => entry.decisionComment ?? '',
      hideBelow: 'desktop',
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for time access to review submitted hours." />;
  }

  return (
    <>
      <PageHeader
        title="Time approvals"
        description="Approve or reject submitted time by person, project, or period. Approved time is what becomes invoiceable."
        actions={
          canApprove ? (
            <div className="rb-ledger-row-actions">
              <Button
                type="button"
                loading={busy}
                disabled={selected.size === 0 || status === 'APPROVED'}
                onClick={() => void decide('approve')}
              >
                <ThumbsUp aria-hidden="true" /> Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={busy}
                disabled={selected.size === 0 || status === 'APPROVED'}
                onClick={() => void decide('reject')}
              >
                <ThumbsDown aria-hidden="true" /> Reject
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={busy}
                disabled={selected.size === 0 || status !== 'APPROVED'}
                onClick={() => void decide('unlock')}
              >
                <Undo2 aria-hidden="true" /> Unlock
              </Button>
            </div>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="approval-status">Status</Label>
            <Select
              id="approval-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {TIME_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="approval-project">Project</Label>
            <Select
              id="approval-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="approval-from">From</Label>
            <Input
              id="approval-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="approval-to">To</Label>
            <Input
              id="approval-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <Badge tone="info">{totalHours(entries ?? [])} hours</Badge>
        </Card>
        {canApprove ? (
          <Card className="rb-ledger-form-card">
            <div className="rb-field">
              <Label htmlFor="approval-comment">
                Decision comment (required to reject, kept on the entry either way)
              </Label>
              <Textarea
                id="approval-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={500}
                rows={2}
              />
            </div>
          </Card>
        ) : null}
        {!entries && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Time awaiting a decision"
            columns={columns}
            rows={entries ?? []}
            emptyTitle="Nothing to review"
            emptyDescription="Submitted time appears here for approval."
          />
        )}
      </div>
    </>
  );
}

// --- Profitability ------------------------------------------------------------------------------

export function ProjectProfitabilityPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'projects.profitability.view');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [profitability, setProfitability] = useState<ProjectProfitability | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId || !canView) return;
    apiRequest<ProjectListResponse>(`/organizations/${organizationId}/projects`)
      .then((response) => {
        setProjects(response.data);
        setProjectId((current) => current || (response.data[0]?.id ?? ''));
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Projects could not be loaded.');
      });
  }, [canView, organizationId]);

  useEffect(() => {
    if (!organizationId || !projectId) {
      setProfitability(null);
      return;
    }
    apiRequest<ProjectProfitabilityResponse>(
      `/organizations/${organizationId}/projects/${projectId}/profitability`,
    )
      .then((response) => {
        setProfitability(response.data);
        setError(null);
      })
      .catch((caught: unknown) => {
        setProfitability(null);
        setError(caught instanceof Error ? caught.message : 'Profitability could not be loaded.');
      });
  }, [organizationId, projectId]);

  const project = projects.find((row) => row.id === projectId) ?? null;

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for profitability access to see project margin." />;
  }

  return (
    <>
      <PageHeader
        title="Project profitability"
        description="Margin by project, read from posted journal lines rather than a parallel sum, so it reconciles to the profit and loss."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/projects">All projects</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} />
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="profitability-project">
              <Briefcase aria-hidden="true" /> Project
            </Label>
            <Select
              id="profitability-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Choose project</option>
              {projects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </div>
          {project ? <StatusBadge status={project.status} /> : null}
          {project ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/projects/${project.id}`}>Open project</Link>
            </Button>
          ) : null}
        </Card>
        {project ? (
          <ProfitabilityPanel profitability={profitability} project={project} />
        ) : (
          <Skeleton />
        )}
      </div>
    </>
  );
}

// --- Shared -------------------------------------------------------------------------------------

function timeColumns(currency: string): DataTableColumn<TimeEntry>[] {
  return [
    {
      key: 'date',
      header: 'Date',
      cell: (entry) => (
        <div>
          <strong>{entry.entryDate}</strong>
          <span className="rb-table-secondary">{entry.projectName}</span>
        </div>
      ),
    },
    {
      key: 'task',
      header: 'Task',
      cell: (entry) => entry.taskName ?? 'No task',
      hideBelow: 'tablet',
    },
    { key: 'hours', header: 'Hours', align: 'right', cell: (entry) => entry.hours },
    {
      key: 'billable',
      header: 'Billable',
      cell: (entry) =>
        entry.billable ? <Badge tone="info">Billable</Badge> : <Badge>Internal</Badge>,
      hideBelow: 'tablet',
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (entry) => formatMinor(entry.amountMinor, currency),
    },
    { key: 'status', header: 'Status', cell: (entry) => <StatusBadge status={entry.status} /> },
    { key: 'note', header: 'Note', cell: (entry) => entry.note ?? '', hideBelow: 'desktop' },
  ];
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
        <div className="rb-auth-notice" role="status">
          {notice}
        </div>
      ) : null}
    </>
  );
}

function decimalToMinor(value: string): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const minor = `${whole || '0'}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${minor || '0'}`;
}

function minorToDecimal(value: string | null): string {
  if (value === null) return '';
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
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

/** Sums two-decimal hour strings in hundredths, so a long timesheet cannot drift on binary floats. */
function totalHours(entries: readonly TimeEntry[]): string {
  const hundredths = entries.reduce((total, entry) => {
    const [whole = '0', fraction = ''] = entry.hours.split('.');
    return total + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
  }, 0n);
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}

function formatElapsed(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function label(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1)}${part.slice(1).toLowerCase()}`)
    .join(' ');
}
