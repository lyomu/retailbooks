'use client';

import type {
  AttachmentListResponse,
  Expense,
  ExpenseCategory,
  ExpenseStatus,
  LedgerAccount,
  Project,
  TaxCode,
  Vendor,
} from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  FieldMessage,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@retailbooks/ui';
import { CheckCircle2, FilePlus2, Paperclip, Save, Search, Upload, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, apiRequest, apiUpload } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { TransactionCollaboration } from './transaction-collaboration';

type ExpenseListResponse = { data: Expense[] };
type ExpenseResponse = { data: Expense };
type ProjectListResponse = { data: Project[] };
type VendorListResponse = { data: Vendor[] };
type AccountListResponse = { data: LedgerAccount[] };
type TaxCodeListResponse = { data: TaxCode[] };
type ExpenseCategoryListResponse = { data: ExpenseCategory[] };
// The listing no longer carries a signed URL: the link is issued by a separate, re-authorized
// download endpoint, so a stale list can never hand out a live link to bytes.
type AttachmentRow = Omit<AttachmentListResponse['data'][number], 'downloadUrl'>;

const statusOptions: readonly ExpenseStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'VOID',
  'CANCELLED',
];

export function ExpensesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'purchases.expenses.view');
  const canManage = hasPermission(organization, 'purchases.expenses.manage');

  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | ExpenseStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<ExpenseListResponse>(
        `/organizations/${organizationId}/expenses${suffix}`,
      );
      setExpenses(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Expenses could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return expenses ?? [];
    return (expenses ?? []).filter((expense) =>
      `${expense.expenseNumber ?? ''} ${expense.payeeVendorName ?? ''} ${expense.payeeName ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [expenses, query]);

  const columns: readonly DataTableColumn<Expense>[] = [
    {
      key: 'expense',
      header: 'Expense',
      cell: (expense) => (
        <div>
          <strong>{expense.expenseNumber ?? 'Draft'}</strong>
          <span className="rb-table-secondary">
            {expense.payeeVendorName ?? expense.payeeName ?? '—'}
          </span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (expense) => <StatusBadge status={expense.status} /> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (expense) => formatMinor(expense.totalMinor, expense.currency),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (expense) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/expenses/${expense.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant expense access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Record, approve, and post immediately-paid spend."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/expenses/new">
                <FilePlus2 aria-hidden="true" /> New expense
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="expense-search">
              <Search aria-hidden="true" /> Search expenses
            </Label>
            <Input
              id="expense-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by number or payee..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="expense-status">Status</Label>
            <Select
              id="expense-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All expenses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{expenses?.length ?? 0} expenses</Badge>
        </Card>

        {!expenses && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState title="No expenses yet" description="Record your first expense." />
        ) : (
          <DataTable caption="Expenses" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const EXPENSE_FLASH_NOTICE_KEY = 'rb-expense-notice';

export function ExpenseEditorPage({ expenseId }: { expenseId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'purchases.expenses.manage');
  const canApprove = hasPermission(organization, 'purchases.expenses.approve');
  const canPost = hasPermission(organization, 'purchases.expenses.post');
  const canVoid = hasPermission(organization, 'purchases.expenses.void');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expense, setExpense] = useState<Expense | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[] | null>(null);
  const [payeeVendorId, setPayeeVendorId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidThroughAccountId, setPaidThroughAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [taxCodeId, setTaxCodeId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAttachments = useCallback(async () => {
    if (!organizationId || !expenseId) return;
    try {
      const response = await apiRequest<AttachmentListResponse>(
        `/organizations/${organizationId}/expenses/${expenseId}/attachments`,
      );
      setAttachments(response.data);
    } catch {
      // Non-fatal.
    }
  }, [organizationId, expenseId]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [
        vendorResponse,
        accountResponse,
        taxCodeResponse,
        categoryResponse,
        projectResponse,
        expenseResponse,
      ] = await Promise.all([
        apiRequest<VendorListResponse>(`/organizations/${organizationId}/vendors?status=ACTIVE`),
        apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        apiRequest<ExpenseCategoryListResponse>(
          `/organizations/${organizationId}/expense-categories`,
        ),
        // Attributing cost to a project is optional, and the person recording an expense may not
        // have project access, so a rejection here must not fail the expense screen.
        apiRequest<ProjectListResponse>(
          `/organizations/${organizationId}/projects?status=OPEN`,
        ).catch(() => ({ data: [] as Project[] })),
        expenseId
          ? apiRequest<ExpenseResponse>(`/organizations/${organizationId}/expenses/${expenseId}`)
          : Promise.resolve(null),
      ]);
      setVendors(vendorResponse.data);
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      setCategories(categoryResponse.data.filter((category) => category.active));
      setProjects(projectResponse.data);
      if (expenseResponse) {
        const data = expenseResponse.data;
        setExpense(data);
        setPayeeVendorId(data.payeeVendorId ?? '');
        setPayeeName(data.payeeName ?? '');
        setExpenseDate(data.expenseDate);
        setPaidThroughAccountId(data.paidThroughAccountId);
        setCategoryId(data.categoryId ?? '');
        setProjectId(data.projectId ?? '');
        setTaxCodeId(data.taxCodeId ?? '');
        setAmount(minorToDecimal(data.amountMinor));
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The expense could not be loaded.');
    }
  }, [expenseId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(EXPENSE_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(EXPENSE_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [expenseId]);

  const currency = expense?.currency ?? organization?.baseCurrency ?? 'KES';
  const editable = (expense ? expense.status === 'DRAFT' : true) && canManage;

  async function saveDraft() {
    if (!organizationId) return null;
    if (!payeeVendorId && !payeeName) {
      setError('Choose a vendor or enter a payee name.');
      return null;
    }
    setBusy('save');
    setError(null);
    try {
      const payload = {
        payeeVendorId: payeeVendorId || undefined,
        payeeName: payeeVendorId ? undefined : payeeName || undefined,
        expenseDate,
        paidThroughAccountId,
        categoryId: categoryId || undefined,
        projectId: projectId || undefined,
        taxCodeId: taxCodeId || undefined,
        amountMinor: decimalToMinor(amount || '0'),
      };
      const response = await apiRequest<ExpenseResponse>(
        expenseId
          ? `/organizations/${organizationId}/expenses/${expenseId}`
          : `/organizations/${organizationId}/expenses`,
        { method: expenseId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setExpense(response.data);
      if (!expenseId) {
        window.sessionStorage.setItem(EXPENSE_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/expenses/${response.data.id}`);
      } else {
        setNotice('Draft saved.');
      }
      return response.data;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The draft could not be saved.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function runAction(action: string, noticeText: string, headers?: Record<string, string>) {
    if (!organizationId || !expense?.id) return;
    setBusy(action);
    setError(null);
    try {
      const response = await apiRequest<ExpenseResponse>(
        `/organizations/${organizationId}/expenses/${expense.id}/${action}`,
        { method: 'POST', ...(headers ? { headers } : {}) },
      );
      setExpense(response.data);
      setNotice(noticeText);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action could not be completed.');
    } finally {
      setBusy(null);
    }
  }

  /** Re-authorizes and then opens the short-lived link, rather than trusting a listed URL. */
  async function openAttachment(attachmentId: string) {
    if (!organizationId || !expense?.id) return;
    try {
      const response = await apiRequest<{ data: { downloadUrl: string } }>(
        `/organizations/${organizationId}/expenses/${expense.id}/attachments/${attachmentId}/download`,
      );
      window.open(response.data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The attachment could not be opened.');
    }
  }

  async function uploadAttachment(file: File) {
    if (!organizationId || !expense?.id) return;
    setBusy('attach');
    setError(null);
    try {
      await apiUpload(`/organizations/${organizationId}/expenses/${expense.id}/attachments`, file);
      setNotice('Receipt uploaded.');
      await loadAttachments();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The receipt could not be uploaded.');
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const cancellable = expense && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(expense.status);

  return (
    <>
      <PageHeader
        title={expense?.expenseNumber ?? (expenseId ? 'Expense' : 'New expense')}
        description="Record spend, optionally route it for approval, then post it to the ledger."
        actions={
          <Button asChild variant="outline">
            <Link href="/expenses">Back to expenses</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
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
        {expenseId && !expense && !error ? <Skeleton /> : null}

        <Card className="rb-journal-editor">
          <div className="rb-journal-editor__meta">
            <div className="rb-field">
              <Label htmlFor="expense-vendor">Vendor</Label>
              <Select
                id="expense-vendor"
                value={payeeVendorId}
                disabled={!editable}
                onChange={(event) => setPayeeVendorId(event.target.value)}
              >
                <option value="">None (free-text payee)</option>
                {vendors.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}
                  </option>
                ))}
              </Select>
            </div>
            {!payeeVendorId ? (
              <div className="rb-field">
                <Label htmlFor="expense-payee-name">Payee name</Label>
                <Input
                  id="expense-payee-name"
                  value={payeeName}
                  disabled={!editable}
                  maxLength={160}
                  onChange={(event) => setPayeeName(event.target.value)}
                />
              </div>
            ) : null}
            <div className="rb-field">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={expenseDate}
                disabled={!editable}
                onChange={(event) => setExpenseDate(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="expense-paid-through">Paid through</Label>
              <Select
                id="expense-paid-through"
                value={paidThroughAccountId}
                disabled={!editable}
                onChange={(event) => setPaidThroughAccountId(event.target.value)}
              >
                <option value="">Choose account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} {account.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="rb-field">
              <Label htmlFor="expense-category">Category</Label>
              <Select
                id="expense-category"
                value={categoryId}
                disabled={!editable}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Default expense account</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="rb-field">
              <Label htmlFor="expense-project">Project</Label>
              <Select
                id="expense-project"
                value={projectId}
                disabled={!editable}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Not attributed to a project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
                {expense?.projectId && !projects.some((row) => row.id === expense.projectId) ? (
                  <option value={expense.projectId}>Current project</option>
                ) : null}
              </Select>
              <FieldMessage>
                Set before posting. Posting freezes it onto the journal, and it is what project
                profitability reads as cost.
              </FieldMessage>
            </div>
            <div className="rb-field">
              <Label htmlFor="expense-tax">Tax</Label>
              <Select
                id="expense-tax"
                value={taxCodeId}
                disabled={!editable}
                onChange={(event) => setTaxCodeId(event.target.value)}
              >
                <option value="">No tax</option>
                {taxCodes.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="rb-field">
              <Label htmlFor="expense-amount">Amount</Label>
              <Input
                id="expense-amount"
                inputMode="decimal"
                value={amount}
                disabled={!editable}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="expense-currency">Currency</Label>
              <Input id="expense-currency" value={currency} disabled />
            </div>
            {expense ? <StatusBadge status={expense.status} /> : null}
          </div>

          <div className="rb-journal-editor__footer">
            <div>
              {expense && expense.status === 'POSTED' ? (
                <>
                  <span>Tax {formatMinor(expense.taxAmountMinor ?? '0', currency)}</span>
                  <span>Total {formatMinor(expense.totalMinor, currency)}</span>
                </>
              ) : (
                <Badge tone="info">Tax is calculated when the expense is posted</Badge>
              )}
            </div>
            <div className="rb-dialog-footer">
              {editable ? (
                <Button
                  type="button"
                  onClick={() => void saveDraft()}
                  loading={busy === 'save'}
                  disabled={!paidThroughAccountId || !amount}
                >
                  <Save aria-hidden="true" /> Save draft
                </Button>
              ) : null}
              {expense?.status === 'DRAFT' && canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void runAction('submit', 'Submitted for approval.')}
                  loading={busy === 'submit'}
                >
                  Submit for approval
                </Button>
              ) : null}
              {expense?.status === 'PENDING_APPROVAL' && canApprove ? (
                <Button
                  type="button"
                  onClick={() => void runAction('approve', 'Expense approved.')}
                  loading={busy === 'approve'}
                >
                  <CheckCircle2 aria-hidden="true" /> Approve
                </Button>
              ) : null}
              {(expense?.status === 'DRAFT' || expense?.status === 'APPROVED') && canPost ? (
                <Button
                  type="button"
                  onClick={() =>
                    void runAction('post', 'Expense posted.', {
                      'Idempotency-Key': crypto.randomUUID(),
                    })
                  }
                  loading={busy === 'post'}
                >
                  <CheckCircle2 aria-hidden="true" /> Post
                </Button>
              ) : null}
              {expense?.status === 'POSTED' && canVoid ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void runAction('void', 'Expense voided.')}
                  loading={busy === 'void'}
                >
                  <XCircle aria-hidden="true" /> Void
                </Button>
              ) : null}
              {cancellable && canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void runAction('cancel', 'Expense cancelled.')}
                  loading={busy === 'cancel'}
                >
                  <XCircle aria-hidden="true" /> Cancel
                </Button>
              ) : null}
            </div>
          </div>
          {!paidThroughAccountId && editable ? (
            <FieldMessage error>
              Choose a paid-through account before saving this expense.
            </FieldMessage>
          ) : null}
        </Card>

        {expense ? (
          <Card className="rb-ledger-toolbar">
            <div className="rb-field-grid">
              <strong>
                <Paperclip aria-hidden="true" /> Receipt
              </strong>
              {canManage ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadAttachment(file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={busy === 'attach'}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload aria-hidden="true" /> Upload
                  </Button>
                </>
              ) : null}
            </div>
            {attachments && attachments.length > 0 ? (
              <ul className="rb-attachment-list">
                {attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <button
                      type="button"
                      className="rb-attachment-link"
                      onClick={() => void openAttachment(attachment.id)}
                    >
                      {attachment.filename}
                    </button>
                    <span className="rb-table-secondary">
                      {(attachment.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="rb-table-secondary">No receipt uploaded yet.</span>
            )}
          </Card>
        ) : null}
        {organizationId && expenseId ? (
          <TransactionCollaboration
            organizationId={organizationId}
            targetType="EXPENSE"
            targetId={expenseId}
            canComment={hasPermission(organization, 'collaboration.comments.create')}
            canUpload={
              hasPermission(organization, 'collaboration.attachments.upload') &&
              hasPermission(organization, 'purchases.expenses.manage')
            }
          />
        ) : null}
      </div>
    </>
  );
}

function decimalToMinor(value: string, scale = 2): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${whole}${fraction.padEnd(scale, '0').slice(0, scale)}`.replace(/^0+(?=\d)/, '');
}

function minorToDecimal(value: string): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const cents = amount % 100n;
  return `${whole}.${cents.toString().padStart(2, '0')}`;
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
