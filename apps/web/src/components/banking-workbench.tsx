'use client';

import type {
  BankRule,
  BankRuleCondition,
  BankRuleField,
  BankRuleOperator,
  BankTransaction,
  BankTransactionDisposition,
  FinancialAccount,
  FinancialAccountType,
  LedgerAccount,
  MatchTargetType,
  Reconciliation,
  ReconciliationDetail,
  StatementImport,
  StatementImportRowOutcome,
  Transfer,
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
  Textarea,
  type DataTableColumn,
} from '@retailbooks/ui';
import {
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  FileUp,
  Link2,
  Plus,
  RotateCcw,
  Save,
  Search,
  SplitSquareHorizontal,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError, apiRequest, apiUpload } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';

type AccountListResponse = { data: LedgerAccount[] };
type FinancialAccountListResponse = { data: FinancialAccount[] };
type FinancialAccountResponse = { data: FinancialAccount };
type BankRuleListResponse = { data: BankRule[] };
type BankRuleResponse = { data: BankRule };
type StatementImportListResponse = { data: StatementImport[] };
type StatementImportResponse = { data: StatementImport };
type StatementImportFailedRowsResponse = { data: StatementImportRowOutcome[] };
type BankTransactionListResponse = { data: BankTransaction[] };
type BankTransactionResponse = { data: BankTransaction };
type TransferListResponse = { data: Transfer[] };
type TransferResponse = { data: Transfer };
type ReconciliationListResponse = { data: Reconciliation[] };
type ReconciliationResponse = { data: ReconciliationDetail };
type ImportRowView = StatementImportRowOutcome & { id: string };

const financialAccountTypes: readonly FinancialAccountType[] = [
  'BANK',
  'CASH',
  'CREDIT_CARD',
  'OTHER',
];
const dispositions: readonly BankTransactionDisposition[] = [
  'UNRESOLVED',
  'MATCHED',
  'POSTED',
  'EXCLUDED',
];
const ruleFields: readonly BankRuleField[] = ['description', 'reference', 'amountMinor', 'direction'];
const ruleOperators: readonly BankRuleOperator[] = ['contains', 'equals', 'gt', 'gte', 'lt', 'lte'];
const matchTargetTypes: readonly MatchTargetType[] = [
  'PAYMENT_RECEIVED',
  'PAYMENT_MADE',
  'EXPENSE',
  'TRANSFER',
];

type CategorizeLine = { key: string; accountId: string; amount: string; description: string };

const blankCondition = (): BankRuleCondition => ({
  field: 'description',
  operator: 'contains',
  value: '',
});

const blankCategorizeLine = (amount = '', accountId = '', description = ''): CategorizeLine => ({
  key: crypto.randomUUID(),
  accountId,
  amount,
  description,
});

export function FinancialAccountsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'banking.accounts.view');
  const canManage = hasPermission(organization, 'banking.accounts.manage');

  const [accounts, setAccounts] = useState<FinancialAccount[] | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [activeFilter, setActiveFilter] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<FinancialAccount | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = activeFilter ? `?active=${activeFilter}` : '';
      const [financialResponse, ledgerResponse] = await Promise.all([
        apiRequest<FinancialAccountListResponse>(
          `/organizations/${organizationId}/financial-accounts${suffix}`,
        ),
        apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
      ]);
      setAccounts(financialResponse.data);
      setLedgerAccounts(ledgerResponse.data.filter((account) => account.status === 'ACTIVE'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Financial accounts could not be loaded.');
    }
  }, [activeFilter, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ledgerName = useMemo(() => accountLabelMap(ledgerAccounts), [ledgerAccounts]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts ?? [];
    return (accounts ?? []).filter((account) =>
      `${account.name} ${account.type} ${account.currency}`.toLowerCase().includes(needle),
    );
  }, [accounts, query]);

  async function setActive(account: FinancialAccount, active: boolean) {
    if (!organizationId) return;
    setError(null);
    try {
      await apiRequest<FinancialAccountResponse>(
        `/organizations/${organizationId}/financial-accounts/${account.id}`,
        { method: 'PATCH', body: JSON.stringify({ active }) },
      );
      setNotice(`${account.name} was ${active ? 'reactivated' : 'deactivated'}.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The financial account could not be updated.',
      );
    }
  }

  const columns: readonly DataTableColumn<FinancialAccount>[] = [
    {
      key: 'account',
      header: 'Account',
      cell: (account) => (
        <div>
          <strong>{account.name}</strong>
          <span className="rb-table-secondary">{ledgerName.get(account.glAccountId) ?? 'Ledger account'}</span>
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (account) => label(account.type) },
    { key: 'currency', header: 'Currency', cell: (account) => account.currency },
    {
      key: 'opening',
      header: 'Opening',
      align: 'right',
      cell: (account) => formatMinor(account.openingBalanceMinor, account.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (account) => <StatusBadge status={account.active ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (account) =>
        canManage ? (
          <div className="rb-inline-actions">
            <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(account)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void setActive(account, !account.active)}
            >
              {account.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant financial-account access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Financial accounts"
        description="Bank, cash, card, and other statement-bearing accounts linked to the ledger."
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setShowCreate(true);
              }}
            >
              <Plus aria-hidden="true" /> Add account
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {(showCreate || editing) && canManage ? (
          <FinancialAccountForm
            account={editing}
            organizationId={organizationId}
            ledgerAccounts={ledgerAccounts}
            fallbackCurrency={organization?.baseCurrency ?? 'KES'}
            onCancel={() => {
              setShowCreate(false);
              setEditing(null);
            }}
            onSaved={(account) => {
              setNotice(`${account.name} was saved.`);
              setShowCreate(false);
              setEditing(null);
              void load();
            }}
          />
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="financial-account-search">
              <Search aria-hidden="true" /> Search accounts
            </Label>
            <Input
              id="financial-account-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by account, type, or currency..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="financial-account-active">Status</Label>
            <Select
              id="financial-account-active"
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value)}
            >
              <option value="">All accounts</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </div>
          <Badge>{filtered.length} accounts</Badge>
        </Card>
        {!accounts && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Financial accounts"
            columns={columns}
            rows={filtered}
            emptyTitle="No financial accounts"
            emptyDescription="Add a statement-bearing account before importing transactions."
          />
        )}
      </div>
    </>
  );
}

function FinancialAccountForm({
  account,
  organizationId,
  ledgerAccounts,
  fallbackCurrency,
  onCancel,
  onSaved,
}: {
  account: FinancialAccount | null;
  organizationId: string | null;
  ledgerAccounts: readonly LedgerAccount[];
  fallbackCurrency: string;
  onCancel: () => void;
  onSaved: (account: FinancialAccount) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const openingBalanceMinor = decimalToMinor(formValue(data, 'openingBalance'));
    const body = {
      name: formValue(data, 'name'),
      type: formValue(data, 'type'),
      currency: formValue(data, 'currency').toUpperCase(),
      glAccountId: formValue(data, 'glAccountId'),
      ...(account ? {} : { openingBalanceMinor }),
      ...(account ? { active: formValue(data, 'active') === 'true' } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<FinancialAccountResponse>(
        account
          ? `/organizations/${organizationId}/financial-accounts/${account.id}`
          : `/organizations/${organizationId}/financial-accounts`,
        { method: account ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The account could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <div>
            <h2>{account ? `Edit ${account.name}` : 'Add financial account'}</h2>
            <p>The selected ledger account receives categorized statement activity.</p>
          </div>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="financial-account-name">Name</Label>
            <Input id="financial-account-name" name="name" defaultValue={account?.name ?? ''} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="financial-account-type">Type</Label>
            <Select id="financial-account-type" name="type" defaultValue={account?.type ?? 'BANK'}>
              {financialAccountTypes.map((type) => (
                <option key={type} value={type}>
                  {label(type)}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="financial-account-currency">Currency</Label>
            <Input
              id="financial-account-currency"
              name="currency"
              defaultValue={account?.currency ?? fallbackCurrency}
              required
              maxLength={3}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="financial-account-gl">Ledger account</Label>
            <Select id="financial-account-gl" name="glAccountId" defaultValue={account?.glAccountId ?? ''} required>
              <option value="">Choose account</option>
              {ledgerAccounts.map((ledgerAccount) => (
                <option key={ledgerAccount.id} value={ledgerAccount.id}>
                  {ledgerAccount.code} {ledgerAccount.name}
                </option>
              ))}
            </Select>
          </div>
          {!account ? (
            <div className="rb-field">
              <Label htmlFor="financial-account-opening">Opening balance</Label>
              <Input
                id="financial-account-opening"
                name="openingBalance"
                inputMode="decimal"
                defaultValue="0.00"
              />
            </div>
          ) : (
            <div className="rb-field">
              <Label htmlFor="financial-account-active-field">Status</Label>
              <Select
                id="financial-account-active-field"
                name="active"
                defaultValue={account.active ? 'true' : 'false'}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </div>
          )}
        </div>
        <div className="rb-dialog-footer">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> Save account
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function BankRulesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'banking.rules.view');
  const canManage = hasPermission(organization, 'banking.rules.manage');

  const [rules, setRules] = useState<BankRule[] | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [editing, setEditing] = useState<BankRule | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [ruleResponse, accountResponse] = await Promise.all([
        apiRequest<BankRuleListResponse>(`/organizations/${organizationId}/bank-rules`),
        apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
      ]);
      setRules(ruleResponse.data);
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Bank rules could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accountNames = useMemo(() => accountLabelMap(accounts), [accounts]);
  const columns: readonly DataTableColumn<BankRule>[] = [
    {
      key: 'rule',
      header: 'Rule',
      cell: (rule) => (
        <div>
          <strong>{rule.name}</strong>
          <span className="rb-table-secondary">
            {rule.conditions.length} condition{rule.conditions.length === 1 ? '' : 's'} · priority {rule.priority}
          </span>
        </div>
      ),
    },
    {
      key: 'suggestion',
      header: 'Suggestion',
      cell: (rule) => accountNames.get(rule.suggestAccountId ?? '') ?? 'No account suggestion',
    },
    { key: 'mode', header: 'Mode', cell: (rule) => (rule.matchAny ? 'Any condition' : 'All conditions') },
    { key: 'status', header: 'Status', cell: (rule) => <StatusBadge status={rule.active ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (rule) =>
        canManage ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(rule)}>
            Edit
          </Button>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for banking rule access to review categorization automation." />;
  }

  return (
    <>
      <PageHeader
        title="Bank rules"
        description="Suggest categories, contacts, vendors, and tags from imported statement text."
        actions={
          canManage ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setShowCreate(true);
              }}
            >
              <Plus aria-hidden="true" /> Add rule
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {(showCreate || editing) && canManage ? (
          <BankRuleForm
            rule={editing}
            accounts={accounts}
            organizationId={organizationId}
            onCancel={() => {
              setEditing(null);
              setShowCreate(false);
            }}
            onSaved={(rule) => {
              setNotice(`${rule.name} was saved.`);
              setEditing(null);
              setShowCreate(false);
              void load();
            }}
          />
        ) : null}
        {!rules && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Bank rules"
            columns={columns}
            rows={rules ?? []}
            emptyTitle="No bank rules"
            emptyDescription="Create rules to pre-fill imported transaction suggestions."
          />
        )}
      </div>
    </>
  );
}

function BankRuleForm({
  rule,
  accounts,
  organizationId,
  onCancel,
  onSaved,
}: {
  rule: BankRule | null;
  accounts: readonly LedgerAccount[];
  organizationId: string | null;
  onCancel: () => void;
  onSaved: (rule: BankRule) => void;
}) {
  const [conditions, setConditions] = useState<BankRuleCondition[]>(rule?.conditions ?? [blankCondition()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const suggestTags = formValue(data, 'suggestTags')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const body = {
      name: formValue(data, 'name'),
      priority: Number(formValue(data, 'priority') || '100'),
      matchAny: formValue(data, 'matchAny') === 'true',
      conditions: conditions.filter((condition) => condition.value.trim()),
      suggestAccountId: formValue(data, 'suggestAccountId') || undefined,
      suggestContactId: formValue(data, 'suggestContactId') || undefined,
      suggestVendorId: formValue(data, 'suggestVendorId') || undefined,
      suggestTags: suggestTags.length ? suggestTags : undefined,
      stopOnMatch: formValue(data, 'stopOnMatch') === 'true',
      ...(rule ? { active: formValue(data, 'active') === 'true' } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<BankRuleResponse>(
        rule
          ? `/organizations/${organizationId}/bank-rules/${rule.id}`
          : `/organizations/${organizationId}/bank-rules`,
        { method: rule ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The rule could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <div>
            <h2>{rule ? `Edit ${rule.name}` : 'Add bank rule'}</h2>
            <p>Rules are evaluated by priority when a statement row is imported.</p>
          </div>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="bank-rule-name">Name</Label>
            <Input id="bank-rule-name" name="name" defaultValue={rule?.name ?? ''} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="bank-rule-priority">Priority</Label>
            <Input
              id="bank-rule-priority"
              name="priority"
              type="number"
              min={1}
              max={10000}
              defaultValue={rule?.priority ?? 100}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="bank-rule-match-mode">Match mode</Label>
            <Select id="bank-rule-match-mode" name="matchAny" defaultValue={rule?.matchAny ? 'true' : 'false'}>
              <option value="false">All conditions</option>
              <option value="true">Any condition</option>
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="bank-rule-stop">Rule chaining</Label>
            <Select id="bank-rule-stop" name="stopOnMatch" defaultValue={rule?.stopOnMatch ? 'true' : 'false'}>
              <option value="false">Keep evaluating</option>
              <option value="true">Stop on match</option>
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="bank-rule-account">Suggested account</Label>
            <Select id="bank-rule-account" name="suggestAccountId" defaultValue={rule?.suggestAccountId ?? ''}>
              <option value="">No account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="bank-rule-tags">Suggested tags</Label>
            <Input id="bank-rule-tags" name="suggestTags" defaultValue={rule?.suggestTags.join(', ') ?? ''} />
          </div>
          <div className="rb-field">
            <Label htmlFor="bank-rule-contact">Suggested customer/contact id</Label>
            <Input id="bank-rule-contact" name="suggestContactId" defaultValue={rule?.suggestContactId ?? ''} />
          </div>
          <div className="rb-field">
            <Label htmlFor="bank-rule-vendor">Suggested vendor id</Label>
            <Input id="bank-rule-vendor" name="suggestVendorId" defaultValue={rule?.suggestVendorId ?? ''} />
          </div>
          {rule ? (
            <div className="rb-field">
              <Label htmlFor="bank-rule-active">Status</Label>
              <Select id="bank-rule-active" name="active" defaultValue={rule.active ? 'true' : 'false'}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </div>
          ) : null}
        </div>
        <div className="rb-journal-lines" role="table" aria-label="Bank rule conditions">
          <div className="rb-journal-lines__head" role="row">
            <span>Field</span>
            <span>Operator</span>
            <span>Value</span>
            <span />
          </div>
          {conditions.map((condition, index) => (
            <div className="rb-journal-lines__row" role="row" key={`${condition.field}-${index}`}>
              <Select
                aria-label={`Condition ${index + 1} field`}
                value={condition.field}
                onChange={(event) => updateCondition(index, { field: event.target.value as BankRuleField })}
              >
                {ruleFields.map((field) => (
                  <option key={field} value={field}>
                    {label(field)}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={`Condition ${index + 1} operator`}
                value={condition.operator}
                onChange={(event) =>
                  updateCondition(index, { operator: event.target.value as BankRuleOperator })
                }
              >
                {ruleOperators.map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Condition ${index + 1} value`}
                value={condition.value}
                onChange={(event) => updateCondition(index, { value: event.target.value })}
                required
              />
              <Button
                variant="ghost"
                size="icon"
                type="button"
                aria-label={`Remove condition ${index + 1}`}
                onClick={() =>
                  setConditions((current) =>
                    current.length > 1 ? current.filter((_, itemIndex) => itemIndex !== index) : current,
                  )
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
        <div className="rb-dialog-footer">
          <Button type="button" variant="outline" onClick={() => setConditions((current) => [...current, blankCondition()])}>
            <Plus aria-hidden="true" /> Add condition
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={conditions.every((condition) => !condition.value.trim())}>
            <Save aria-hidden="true" /> Save rule
          </Button>
        </div>
      </form>
    </Card>
  );

  function updateCondition(index: number, patch: Partial<BankRuleCondition>) {
    setConditions((current) =>
      current.map((condition, itemIndex) =>
        itemIndex === index ? { ...condition, ...patch } : condition,
      ),
    );
  }
}

export function TransfersPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'banking.transfers.view');
  const canManage = hasPermission(organization, 'banking.transfers.manage');

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [accountFilter, setAccountFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const params = accountFilter ? `?financialAccountId=${accountFilter}` : '';
      const [accountResponse, transferResponse] = await Promise.all([
        apiRequest<FinancialAccountListResponse>(`/organizations/${organizationId}/financial-accounts?active=true`),
        apiRequest<TransferListResponse>(`/organizations/${organizationId}/transfers${params}`),
      ]);
      setAccounts(accountResponse.data);
      setTransfers(transferResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Transfers could not be loaded.');
    }
  }, [accountFilter, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accountNames = useMemo(() => financialAccountLabelMap(accounts), [accounts]);

  async function voidTransfer(transfer: Transfer) {
    if (!organizationId) return;
    setError(null);
    try {
      await apiRequest<TransferResponse>(`/organizations/${organizationId}/transfers/${transfer.id}/void`, {
        method: 'POST',
      });
      setNotice(`${transfer.transferNumber ?? 'Transfer'} was voided.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The transfer could not be voided.');
    }
  }

  const columns: readonly DataTableColumn<Transfer>[] = [
    {
      key: 'transfer',
      header: 'Transfer',
      cell: (transfer) => (
        <div>
          <strong>{transfer.transferNumber ?? 'Transfer'}</strong>
          <span className="rb-table-secondary">{transfer.description ?? transfer.transferDate}</span>
        </div>
      ),
    },
    {
      key: 'from',
      header: 'From',
      cell: (transfer) => accountNames.get(transfer.fromFinancialAccountId) ?? transfer.fromCurrency,
    },
    {
      key: 'to',
      header: 'To',
      cell: (transfer) => accountNames.get(transfer.toFinancialAccountId) ?? transfer.toCurrency,
      hideBelow: 'tablet',
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (transfer) => formatMinor(transfer.fromAmountMinor, transfer.fromCurrency),
    },
    { key: 'status', header: 'Status', cell: (transfer) => <StatusBadge status={transfer.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (transfer) =>
        canManage && transfer.status === 'POSTED' ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => void voidTransfer(transfer)}>
            Void
          </Button>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for banking transfer access to review account movements." />;
  }

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Move money between financial accounts with balanced linked journals."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setShowCreate((value) => !value)}>
              <ArrowRightLeft aria-hidden="true" /> New transfer
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {showCreate && canManage ? (
          <TransferForm
            organizationId={organizationId}
            accounts={accounts}
            onSaved={(transfer) => {
              setNotice(`${transfer.transferNumber ?? 'Transfer'} was posted.`);
              setShowCreate(false);
              void load();
            }}
          />
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="transfer-account-filter">Account</Label>
            <Select id="transfer-account-filter" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{transfers?.length ?? 0} transfers</Badge>
        </Card>
        {!transfers && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Transfers"
            columns={columns}
            rows={transfers ?? []}
            emptyTitle="No transfers"
            emptyDescription="Post a transfer when money moves between financial accounts."
          />
        )}
      </div>
    </>
  );
}

function TransferForm({
  organizationId,
  accounts,
  onSaved,
}: {
  organizationId: string | null;
  accounts: readonly FinancialAccount[];
  onSaved: (transfer: Transfer) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const body = {
      fromFinancialAccountId: formValue(data, 'fromFinancialAccountId'),
      toFinancialAccountId: formValue(data, 'toFinancialAccountId'),
      transferDate: formValue(data, 'transferDate'),
      fromAmountMinor: decimalToMinor(formValue(data, 'fromAmount')),
      toAmountMinor: decimalToMinor(formValue(data, 'toAmount')),
      description: formValue(data, 'description') || undefined,
    };
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<TransferResponse>(`/organizations/${organizationId}/transfers`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      onSaved(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The transfer could not be posted.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <h2>New transfer</h2>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <FinancialAccountSelect labelText="From account" id="transfer-from" name="fromFinancialAccountId" accounts={accounts} />
          <FinancialAccountSelect labelText="To account" id="transfer-to" name="toFinancialAccountId" accounts={accounts} />
          <div className="rb-field">
            <Label htmlFor="transfer-date">Date</Label>
            <Input id="transfer-date" name="transferDate" type="date" defaultValue={today} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="transfer-from-amount">From amount</Label>
            <Input id="transfer-from-amount" name="fromAmount" inputMode="decimal" placeholder="0.00" required />
          </div>
          <div className="rb-field">
            <Label htmlFor="transfer-to-amount">To amount</Label>
            <Input id="transfer-to-amount" name="toAmount" inputMode="decimal" placeholder="0.00" required />
          </div>
          <div className="rb-field">
            <Label htmlFor="transfer-description">Description</Label>
            <Input id="transfer-description" name="description" maxLength={240} />
          </div>
        </div>
        <div className="rb-dialog-footer">
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> Post transfer
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function StatementImportsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'banking.transactions.view');
  const canManage = hasPermission(organization, 'banking.transactions.manage');

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [imports, setImports] = useState<StatementImport[] | null>(null);
  const [accountFilter, setAccountFilter] = useState('');
  const [selectedImportId, setSelectedImportId] = useState('');
  const [failedRows, setFailedRows] = useState<StatementImportRowOutcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const params = accountFilter ? `?financialAccountId=${accountFilter}` : '';
      const [accountResponse, importResponse] = await Promise.all([
        apiRequest<FinancialAccountListResponse>(`/organizations/${organizationId}/financial-accounts?active=true`),
        apiRequest<StatementImportListResponse>(`/organizations/${organizationId}/statement-imports${params}`),
      ]);
      setAccounts(accountResponse.data);
      setImports(importResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Statement imports could not be loaded.');
    }
  }, [accountFilter, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!organizationId || !selectedImportId) {
      setFailedRows(null);
      return;
    }
    apiRequest<StatementImportFailedRowsResponse>(
      `/organizations/${organizationId}/statement-imports/${selectedImportId}/failed-rows`,
    )
      .then((response) => setFailedRows(response.data))
      .catch(() => setFailedRows(null));
  }, [organizationId, selectedImportId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const file = data.get('file');
    const financialAccountId = formValue(data, 'financialAccountId');
    if (!(file instanceof File) || !financialAccountId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiUpload<StatementImportResponse>(
        `/organizations/${organizationId}/statement-imports`,
        file,
        { financialAccountId },
      );
      setNotice(importSummary(response.data));
      setSelectedImportId(response.data.id);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The statement file could not be imported.');
    } finally {
      setBusy(false);
    }
  }

  const accountNames = useMemo(() => financialAccountLabelMap(accounts), [accounts]);
  const columns: readonly DataTableColumn<StatementImport>[] = [
    {
      key: 'file',
      header: 'File',
      cell: (statementImport) => (
        <div>
          <strong>{statementImport.fileName}</strong>
          <span className="rb-table-secondary">{accountNames.get(statementImport.financialAccountId) ?? 'Account'}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (statementImport) => <StatusBadge status={statementImport.status} /> },
    {
      key: 'rows',
      header: 'Rows',
      align: 'right',
      cell: (statementImport) =>
        `${statementImport.importedCount} imported · ${statementImport.duplicateCount} duplicate · ${statementImport.failedCount} failed`,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (statementImport) => (
        <Button variant="ghost" size="sm" type="button" onClick={() => setSelectedImportId(statementImport.id)}>
          Failed rows
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for banking transaction access to import statement files." />;
  }

  return (
    <>
      <PageHeader
        title="Statement imports"
        description="Upload CSV bank statements and keep duplicate rows out by fingerprint."
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {canManage ? (
          <Card className="rb-ledger-form-card">
            <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
              <div className="rb-ledger-form__heading">
                <div>
                  <h2>Import CSV statement</h2>
                  <p>CSV rows become unresolved bank transactions ready for matching or categorizing.</p>
                </div>
                <Badge tone="info">CSV</Badge>
              </div>
              <div className="rb-field-grid">
                <FinancialAccountSelect labelText="Financial account" id="statement-account" name="financialAccountId" accounts={accounts} />
                <div className="rb-field">
                  <Label htmlFor="statement-file">Statement file</Label>
                  <Input id="statement-file" name="file" type="file" accept=".csv,text/csv" required />
                </div>
              </div>
              <div className="rb-dialog-footer">
                <Button type="submit" loading={busy}>
                  <FileUp aria-hidden="true" /> Upload CSV
                </Button>
              </div>
            </form>
          </Card>
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="statement-import-account-filter">Account</Label>
            <Select
              id="statement-import-account-filter"
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{imports?.length ?? 0} imports</Badge>
        </Card>
        {!imports && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Statement imports"
            columns={columns}
            rows={imports ?? []}
            emptyTitle="No statement imports"
            emptyDescription="Upload a CSV statement to create bank transactions."
          />
        )}
        {selectedImportId ? (
          <Card className="rb-ledger-form-card">
            <div className="rb-ledger-form__heading">
              <h2>Failed and duplicate rows</h2>
            </div>
            {!failedRows ? (
              <Skeleton />
            ) : failedRows.length === 0 ? (
              <EmptyState title="No failed rows" description="This import produced no failed-row details." />
            ) : (
              <DataTable
                caption="Import row outcomes"
                columns={[
                  { key: 'row', header: 'Row', cell: (row) => row.rowNumber },
                  { key: 'description', header: 'Description', cell: (row) => row.description ?? 'No description' },
                  { key: 'amount', header: 'Amount', cell: (row) => row.amount ?? 'No amount' },
                  { key: 'outcome', header: 'Outcome', cell: (row) => <StatusBadge status={row.outcome} /> },
                  { key: 'error', header: 'Error', cell: (row) => row.error ?? 'Duplicate fingerprint' },
                ] satisfies readonly DataTableColumn<ImportRowView>[]}
                rows={failedRows.map((row) => ({ ...row, id: `${selectedImportId}:${row.rowNumber}` }))}
              />
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}

export function BankTransactionsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'banking.transactions.view');
  const canManage = hasPermission(organization, 'banking.transactions.manage');

  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccount[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[] | null>(null);
  const [accountFilter, setAccountFilter] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState<'' | BankTransactionDisposition>('UNRESOLVED');
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [mode, setMode] = useState<'categorize' | 'match' | 'exclude' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const params = new URLSearchParams();
    if (accountFilter) params.set('financialAccountId', accountFilter);
    if (dispositionFilter) params.set('disposition', dispositionFilter);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    try {
      const [financialResponse, ledgerResponse, transactionResponse] = await Promise.all([
        apiRequest<FinancialAccountListResponse>(`/organizations/${organizationId}/financial-accounts?active=true`),
        apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
        apiRequest<BankTransactionListResponse>(`/organizations/${organizationId}/bank-transactions${suffix}`),
      ]);
      setFinancialAccounts(financialResponse.data);
      setLedgerAccounts(ledgerResponse.data.filter((account) => account.status === 'ACTIVE'));
      setTransactions(transactionResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Bank transactions could not be loaded.');
    }
  }, [accountFilter, dispositionFilter, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const financialNames = useMemo(() => financialAccountLabelMap(financialAccounts), [financialAccounts]);
  const ledgerNames = useMemo(() => accountLabelMap(ledgerAccounts), [ledgerAccounts]);

  async function unmatch(transaction: BankTransaction) {
    if (!organizationId) return;
    setError(null);
    try {
      await apiRequest<BankTransactionResponse>(
        `/organizations/${organizationId}/bank-transactions/${transaction.id}/unmatch`,
        { method: 'POST' },
      );
      setNotice('Transaction was unmatched.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The transaction could not be unmatched.');
    }
  }

  const columns: readonly DataTableColumn<BankTransaction>[] = [
    {
      key: 'transaction',
      header: 'Transaction',
      cell: (transaction) => (
        <div>
          <strong>{transaction.description}</strong>
          <span className="rb-table-secondary">
            {transaction.transactionDate} · {financialNames.get(transaction.financialAccountId) ?? transaction.currency}
          </span>
        </div>
      ),
    },
    { key: 'direction', header: 'Direction', cell: (transaction) => label(transaction.direction), hideBelow: 'tablet' },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (transaction) => formatMinor(transaction.amountMinor, transaction.currency),
    },
    {
      key: 'suggested',
      header: 'Suggested',
      cell: (transaction) =>
        transaction.suggestedAccountId ? ledgerNames.get(transaction.suggestedAccountId) ?? 'Suggested account' : 'No suggestion',
      hideBelow: 'tablet',
    },
    { key: 'status', header: 'Status', cell: (transaction) => <StatusBadge status={transaction.disposition} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (transaction) =>
        canManage ? (
          <div className="rb-inline-actions">
            {transaction.disposition === 'UNRESOLVED' ? (
              <>
                <Button variant="ghost" size="sm" type="button" onClick={() => chooseTransaction(transaction, 'categorize')}>
                  Categorize
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => chooseTransaction(transaction, 'match')}>
                  Match
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => chooseTransaction(transaction, 'exclude')}>
                  Exclude
                </Button>
              </>
            ) : null}
            {transaction.disposition === 'MATCHED' ? (
              <Button variant="ghost" size="sm" type="button" onClick={() => void unmatch(transaction)}>
                Unmatch
              </Button>
            ) : null}
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for banking transaction access to work imported statement rows." />;
  }

  return (
    <>
      <PageHeader
        title="Bank transactions"
        description="Resolve imported statement rows by matching, categorizing, splitting, or excluding them."
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="bank-transaction-account-filter">Account</Label>
            <Select id="bank-transaction-account-filter" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="">All accounts</option>
              {financialAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="bank-transaction-disposition-filter">Disposition</Label>
            <Select
              id="bank-transaction-disposition-filter"
              value={dispositionFilter}
              onChange={(event) => setDispositionFilter(event.target.value as typeof dispositionFilter)}
            >
              <option value="">All transactions</option>
              {dispositions.map((disposition) => (
                <option key={disposition} value={disposition}>
                  {label(disposition)}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{transactions?.length ?? 0} rows</Badge>
        </Card>
        {selected && mode ? (
          <BankTransactionActionPanel
            transaction={selected}
            mode={mode}
            organizationId={organizationId}
            ledgerAccounts={ledgerAccounts}
            onCancel={() => {
              setSelected(null);
              setMode(null);
            }}
            onSaved={(message) => {
              setNotice(message);
              setSelected(null);
              setMode(null);
              void load();
            }}
          />
        ) : null}
        {!transactions && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Bank transactions"
            columns={columns}
            rows={transactions ?? []}
            emptyTitle="No bank transactions"
            emptyDescription="Import a statement to create unresolved rows."
          />
        )}
      </div>
    </>
  );

  function chooseTransaction(transaction: BankTransaction, nextMode: 'categorize' | 'match' | 'exclude') {
    setSelected(transaction);
    setMode(nextMode);
  }
}

function BankTransactionActionPanel({
  transaction,
  mode,
  organizationId,
  ledgerAccounts,
  onCancel,
  onSaved,
}: {
  transaction: BankTransaction;
  mode: 'categorize' | 'match' | 'exclude';
  organizationId: string | null;
  ledgerAccounts: readonly LedgerAccount[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [lines, setLines] = useState<CategorizeLine[]>([
    blankCategorizeLine(minorToDecimal(transaction.amountMinor), transaction.suggestedAccountId ?? '', transaction.description),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalMinor = useMemo(
    () => lines.reduce((sum, line) => sum + BigInt(decimalToMinor(line.amount || '0')), 0n),
    [lines],
  );
  const difference = BigInt(transaction.amountMinor) - totalMinor;
  const canCategorize = mode === 'categorize' && difference === 0n && lines.every((line) => line.accountId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mode === 'categorize') {
        await apiRequest<BankTransactionResponse>(
          `/organizations/${organizationId}/bank-transactions/${transaction.id}/categorize`,
          {
            method: 'POST',
            body: JSON.stringify({
              lines: lines.map((line) => ({
                accountId: line.accountId,
                amountMinor: decimalToMinor(line.amount),
                description: line.description || undefined,
              })),
            }),
            headers: { 'Idempotency-Key': crypto.randomUUID() },
          },
        );
        onSaved(lines.length > 1 ? 'Transaction was split and posted.' : 'Transaction was categorized.');
      }
      if (mode === 'match') {
        await apiRequest<BankTransactionResponse>(
          `/organizations/${organizationId}/bank-transactions/${transaction.id}/match`,
          {
            method: 'POST',
            body: JSON.stringify({
              targetType: formValue(data, 'targetType'),
              targetId: formValue(data, 'targetId'),
              note: formValue(data, 'note') || undefined,
            }),
          },
        );
        onSaved('Transaction was matched.');
      }
      if (mode === 'exclude') {
        await apiRequest<BankTransactionResponse>(
          `/organizations/${organizationId}/bank-transactions/${transaction.id}/exclude`,
          { method: 'POST', body: JSON.stringify({ reason: formValue(data, 'reason') }) },
        );
        onSaved('Transaction was excluded.');
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The transaction action could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <div>
            <h2>{mode === 'categorize' ? 'Categorize or split' : mode === 'match' ? 'Match transaction' : 'Exclude transaction'}</h2>
            <p>
              {transaction.transactionDate} · {transaction.description} · {formatMinor(transaction.amountMinor, transaction.currency)}
            </p>
          </div>
          <StatusBadge status={transaction.direction} />
        </div>
        <Messages error={error} />
        {mode === 'categorize' ? (
          <>
            <div className="rb-journal-lines" role="table" aria-label="Category lines">
              <div className="rb-journal-lines__head" role="row">
                <span>Account</span>
                <span>Description</span>
                <span>Amount</span>
                <span />
              </div>
              {lines.map((line, index) => (
                <div className="rb-journal-lines__row" role="row" key={line.key}>
                  <Select
                    aria-label={`Account for category line ${index + 1}`}
                    value={line.accountId}
                    onChange={(event) => updateLine(line.key, { accountId: event.target.value })}
                  >
                    <option value="">Choose account</option>
                    {ledgerAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} {account.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={`Description for category line ${index + 1}`}
                    value={line.description}
                    onChange={(event) => updateLine(line.key, { description: event.target.value })}
                  />
                  <Input
                    aria-label={`Amount for category line ${index + 1}`}
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(event) => updateLine(line.key, { amount: event.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={`Remove category line ${index + 1}`}
                    onClick={() => setLines((current) => (current.length > 1 ? current.filter((candidate) => candidate.key !== line.key) : current))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="rb-journal-editor__footer">
              <div>
                <span>Lines {formatMinor(totalMinor.toString(), transaction.currency)}</span>
                <span>Transaction {formatMinor(transaction.amountMinor, transaction.currency)}</span>
                <Badge tone={difference === 0n ? 'success' : 'warning'}>
                  {difference === 0n ? 'Ready' : `Difference ${formatMinor(difference.toString(), transaction.currency)}`}
                </Badge>
              </div>
              <div className="rb-dialog-footer">
                <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, blankCategorizeLine()])}>
                  <SplitSquareHorizontal aria-hidden="true" /> Add split
                </Button>
              </div>
            </div>
          </>
        ) : null}
        {mode === 'match' ? (
          <div className="rb-field-grid">
            <div className="rb-field">
              <Label htmlFor="bank-match-target-type">Target type</Label>
              <Select id="bank-match-target-type" name="targetType">
                {matchTargetTypes.map((type) => (
                  <option key={type} value={type}>
                    {label(type)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="rb-field">
              <Label htmlFor="bank-match-target-id">Target id</Label>
              <Input id="bank-match-target-id" name="targetId" required />
            </div>
            <div className="rb-field">
              <Label htmlFor="bank-match-note">Note</Label>
              <Input id="bank-match-note" name="note" maxLength={240} />
            </div>
          </div>
        ) : null}
        {mode === 'exclude' ? (
          <div className="rb-field">
            <Label htmlFor="bank-exclude-reason">Reason</Label>
            <Textarea id="bank-exclude-reason" name="reason" required rows={3} maxLength={240} />
          </div>
        ) : null}
        <div className="rb-dialog-footer">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={mode === 'categorize' && !canCategorize}>
            {mode === 'match' ? <Link2 aria-hidden="true" /> : mode === 'exclude' ? <Ban aria-hidden="true" /> : <Save aria-hidden="true" />}
            {mode === 'match' ? 'Match' : mode === 'exclude' ? 'Exclude' : 'Post category'}
          </Button>
        </div>
        {mode === 'categorize' && !canCategorize ? (
          <FieldMessage error>Category lines must choose accounts and equal the statement amount.</FieldMessage>
        ) : null}
      </form>
    </Card>
  );

  function updateLine(key: string, patch: Partial<CategorizeLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
}

export function ReconciliationsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'banking.reconciliations.view');
  const canManage = hasPermission(organization, 'banking.reconciliations.manage');
  const canReopen = hasPermission(organization, 'banking.reconciliations.reopen');

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[] | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [selected, setSelected] = useState<ReconciliationDetail | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accountFilter, setAccountFilter] = useState('');
  const [showStart, setShowStart] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const params = accountFilter ? `?financialAccountId=${accountFilter}` : '';
      const [accountResponse, reconciliationResponse] = await Promise.all([
        apiRequest<FinancialAccountListResponse>(`/organizations/${organizationId}/financial-accounts?active=true`),
        apiRequest<ReconciliationListResponse>(`/organizations/${organizationId}/reconciliations${params}`),
      ]);
      setAccounts(accountResponse.data);
      setReconciliations(reconciliationResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reconciliations could not be loaded.');
    }
  }, [accountFilter, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!organizationId || !selected) {
      setTransactions([]);
      return;
    }
    apiRequest<BankTransactionListResponse>(
      `/organizations/${organizationId}/bank-transactions?financialAccountId=${selected.financialAccountId}`,
    )
      .then((response) => setTransactions(response.data))
      .catch(() => setTransactions([]));
  }, [organizationId, selected]);

  const accountNames = useMemo(() => financialAccountLabelMap(accounts), [accounts]);
  const activeAccount = accounts.find((account) => account.id === selected?.financialAccountId) ?? null;
  const activeCurrency = activeAccount?.currency ?? organization?.baseCurrency ?? 'KES';
  const selectedDifference = selected ? BigInt(selected.difference) : 0n;
  const canComplete = canManage && selected?.status === 'IN_PROGRESS' && selectedDifference === 0n;

  async function openReconciliation(reconciliation: Reconciliation) {
    if (!organizationId) return;
    setError(null);
    try {
      const response = await apiRequest<ReconciliationResponse>(
        `/organizations/${organizationId}/reconciliations/${reconciliation.id}`,
      );
      setSelected(response.data);
      setSelectedIds(new Set());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The reconciliation could not be opened.');
    }
  }

  async function setCleared(cleared: boolean) {
    if (!organizationId || !selected || selectedIds.size === 0) return;
    setBusy(cleared ? 'clear' : 'unclear');
    setError(null);
    try {
      const response = await apiRequest<ReconciliationResponse>(
        `/organizations/${organizationId}/reconciliations/${selected.id}/${cleared ? 'clear' : 'unclear'}`,
        { method: 'POST', body: JSON.stringify({ transactionIds: Array.from(selectedIds) }) },
      );
      setSelected(response.data);
      setSelectedIds(new Set());
      setNotice(cleared ? 'Transactions were cleared.' : 'Transactions were uncleared.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Cleared state could not be updated.');
    } finally {
      setBusy(null);
    }
  }

  async function complete() {
    if (!organizationId || !selected) return;
    setBusy('complete');
    setError(null);
    try {
      const response = await apiRequest<ReconciliationResponse>(
        `/organizations/${organizationId}/reconciliations/${selected.id}/complete`,
        { method: 'POST' },
      );
      setSelected(response.data);
      setNotice('Reconciliation completed.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The reconciliation could not be completed.');
    } finally {
      setBusy(null);
    }
  }

  async function reopen() {
    if (!organizationId || !selected || !reopenReason.trim()) return;
    setBusy('reopen');
    setError(null);
    try {
      const response = await apiRequest<ReconciliationResponse>(
        `/organizations/${organizationId}/reconciliations/${selected.id}/reopen`,
        { method: 'POST', body: JSON.stringify({ reason: reopenReason }) },
      );
      setSelected(response.data);
      setNotice('Reconciliation reopened.');
      setReopenReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The reconciliation could not be reopened.');
    } finally {
      setBusy(null);
    }
  }

  const columns: readonly DataTableColumn<Reconciliation>[] = [
    {
      key: 'period',
      header: 'Statement period',
      cell: (reconciliation) => (
        <div>
          <strong>{reconciliation.statementStartDate} to {reconciliation.statementEndDate}</strong>
          <span className="rb-table-secondary">{accountNames.get(reconciliation.financialAccountId) ?? 'Financial account'}</span>
        </div>
      ),
    },
    {
      key: 'closing',
      header: 'Closing',
      align: 'right',
      cell: (reconciliation) => formatMinor(reconciliation.closingBalanceMinor, activeCurrency),
    },
    { key: 'status', header: 'Status', cell: (reconciliation) => <StatusBadge status={reconciliation.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (reconciliation) => (
        <Button variant="ghost" size="sm" type="button" onClick={() => void openReconciliation(reconciliation)}>
          Open
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for reconciliation access to review statement close-outs." />;
  }

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Clear imported statement rows and complete only when the difference is exactly zero."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setShowStart((value) => !value)}>
              <CheckCircle2 aria-hidden="true" /> Start reconciliation
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {showStart && canManage ? (
          <StartReconciliationForm
            organizationId={organizationId}
            accounts={accounts}
            onSaved={(reconciliation) => {
              setNotice('Reconciliation started.');
              setShowStart(false);
              setSelected(reconciliation);
              void load();
            }}
          />
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="reconciliation-account-filter">Account</Label>
            <Select id="reconciliation-account-filter" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{reconciliations?.length ?? 0} reconciliations</Badge>
        </Card>
        {!reconciliations && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Reconciliations"
            columns={columns}
            rows={reconciliations ?? []}
            emptyTitle="No reconciliations"
            emptyDescription="Start a reconciliation for a financial account's statement period."
          />
        )}
        {selected ? (
          <Card className="rb-journal-editor">
            <div className="rb-ledger-form__heading">
              <div>
                <h2>{accountNames.get(selected.financialAccountId) ?? 'Reconciliation'}</h2>
                <p>{selected.statementStartDate} to {selected.statementEndDate}</p>
              </div>
              <StatusBadge status={selected.status} />
            </div>
            <div className="rb-journal-editor__meta">
              <Badge>Opening {formatMinor(selected.openingBalanceMinor, activeCurrency)}</Badge>
              <Badge>Closing {formatMinor(selected.closingBalanceMinor, activeCurrency)}</Badge>
              <Badge tone={selectedDifference === 0n ? 'success' : 'warning'}>
                Difference {formatMinor(selected.difference, activeCurrency)}
              </Badge>
            </div>
            {selected.status === 'IN_PROGRESS' ? (
              <>
                <div className="rb-table-scroll">
                  <table className="rb-table rb-ledger-table">
                    <caption className="rb-visually-hidden">Transactions available for reconciliation</caption>
                    <thead>
                      <tr>
                        <th>Select</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Disposition</th>
                        <th className="rb-table--right">Amount</th>
                        <th>Cleared</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((transaction) => {
                        const cleared = selected.clearedTransactionIds.includes(transaction.id);
                        return (
                          <tr key={transaction.id}>
                            <td>
                              <input
                                aria-label={`Select ${transaction.description}`}
                                type="checkbox"
                                checked={selectedIds.has(transaction.id)}
                                onChange={(event) => toggleSelected(transaction.id, event.target.checked)}
                              />
                            </td>
                            <td>{transaction.transactionDate}</td>
                            <td>{transaction.description}</td>
                            <td><StatusBadge status={transaction.disposition} /></td>
                            <td className="rb-table--right rb-num">
                              {transaction.direction === 'OUTFLOW' ? '-' : ''}
                              {formatMinor(transaction.amountMinor, transaction.currency)}
                            </td>
                            <td>{cleared ? 'Yes' : 'No'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="rb-journal-editor__footer">
                  <div>
                    <span>{selectedIds.size} selected</span>
                    <span>{selected.clearedTransactionIds.length} cleared</span>
                  </div>
                  <div className="rb-dialog-footer">
                    <Button type="button" variant="outline" onClick={() => void setCleared(false)} loading={busy === 'unclear'} disabled={!canManage || selectedIds.size === 0}>
                      Clear off
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void setCleared(true)} loading={busy === 'clear'} disabled={!canManage || selectedIds.size === 0}>
                      Clear
                    </Button>
                    <Button type="button" onClick={() => void complete()} loading={busy === 'complete'} disabled={!canComplete}>
                      <CheckCircle2 aria-hidden="true" /> Complete
                    </Button>
                  </div>
                </div>
                {!canComplete ? (
                  <FieldMessage error>Completion is blocked until the reconciliation difference is exactly zero.</FieldMessage>
                ) : null}
              </>
            ) : (
              <div className="rb-ledger-stack">
                <FieldMessage>This reconciliation is completed and locked.</FieldMessage>
                {canReopen ? (
                  <div className="rb-field-grid">
                    <div className="rb-field">
                      <Label htmlFor="reopen-reconciliation-reason">Reopen reason</Label>
                      <Input
                        id="reopen-reconciliation-reason"
                        value={reopenReason}
                        onChange={(event) => setReopenReason(event.target.value)}
                        maxLength={240}
                      />
                    </div>
                    <div className="rb-dialog-footer">
                      <Button type="button" variant="outline" onClick={() => void reopen()} loading={busy === 'reopen'} disabled={!reopenReason.trim()}>
                        <RotateCcw aria-hidden="true" /> Reopen
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}

function StartReconciliationForm({
  organizationId,
  accounts,
  onSaved,
}: {
  organizationId: string | null;
  accounts: readonly FinancialAccount[];
  onSaved: (reconciliation: ReconciliationDetail) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const response = await save(data);
    if (response) onSaved(response);
  }

  async function save(data: FormData) {
    setSaving(true);
    setError(null);
    try {
      const started = await apiRequest<{ data: Reconciliation }>(`/organizations/${organizationId}/reconciliations`, {
        method: 'POST',
        body: JSON.stringify({
          financialAccountId: formValue(data, 'financialAccountId'),
          statementStartDate: formValue(data, 'statementStartDate'),
          statementEndDate: formValue(data, 'statementEndDate'),
          openingBalanceMinor: decimalToMinor(formValue(data, 'openingBalance')),
          closingBalanceMinor: decimalToMinor(formValue(data, 'closingBalance')),
        }),
      });
      const detail = await apiRequest<ReconciliationResponse>(
        `/organizations/${organizationId}/reconciliations/${started.data.id}`,
      );
      return detail.data;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The reconciliation could not be started.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <h2>Start reconciliation</h2>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <FinancialAccountSelect labelText="Financial account" id="reconciliation-account" name="financialAccountId" accounts={accounts} />
          <div className="rb-field">
            <Label htmlFor="reconciliation-start-date">Start date</Label>
            <Input id="reconciliation-start-date" name="statementStartDate" type="date" required />
          </div>
          <div className="rb-field">
            <Label htmlFor="reconciliation-end-date">End date</Label>
            <Input id="reconciliation-end-date" name="statementEndDate" type="date" defaultValue={today} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="reconciliation-opening-balance">Opening balance</Label>
            <Input id="reconciliation-opening-balance" name="openingBalance" inputMode="decimal" defaultValue="0.00" required />
          </div>
          <div className="rb-field">
            <Label htmlFor="reconciliation-closing-balance">Closing balance</Label>
            <Input id="reconciliation-closing-balance" name="closingBalance" inputMode="decimal" defaultValue="0.00" required />
          </div>
        </div>
        <div className="rb-dialog-footer">
          <Button type="submit" loading={saving}>
            <CheckCircle2 aria-hidden="true" /> Start
          </Button>
        </div>
      </form>
    </Card>
  );
}

function FinancialAccountSelect({
  labelText,
  id,
  name,
  accounts,
}: {
  labelText: string;
  id: string;
  name: string;
  accounts: readonly FinancialAccount[];
}) {
  return (
    <div className="rb-field">
      <Label htmlFor={id}>{labelText}</Label>
      <Select id={id} name={name} required>
        <option value="">Choose account</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name} · {account.currency}
          </option>
        ))}
      </Select>
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
        <div className="rb-auth-notice" role="status">
          {notice}
        </div>
      ) : null}
    </>
  );
}

function accountLabelMap(accounts: readonly LedgerAccount[]) {
  return new Map(accounts.map((account) => [account.id, `${account.code} ${account.name}`]));
}

function financialAccountLabelMap(accounts: readonly FinancialAccount[]) {
  return new Map(accounts.map((account) => [account.id, `${account.name} · ${account.currency}`]));
}

function importSummary(statementImport: StatementImport) {
  return `${statementImport.importedCount} imported, ${statementImport.duplicateCount} duplicate, ${statementImport.failedCount} failed.`;
}

function decimalToMinor(value: string, scale = 2): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const minor = `${whole || '0'}${fraction.padEnd(scale, '0').slice(0, scale)}`.replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${minor || '0'}`;
}

function minorToDecimal(value: string): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  return `${negative ? '-' : ''}${whole}.${cents.toString().padStart(2, '0')}`;
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
