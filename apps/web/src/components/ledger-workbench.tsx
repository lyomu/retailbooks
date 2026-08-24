'use client';

import type {
  AccountLedgerResponse,
  JournalDetail,
  JournalSummary,
  LedgerAccount,
  LedgerAccountType,
  LedgerNormalBalance,
  TaxCalculationResult,
  TaxCode,
  TrialBalanceResponse,
} from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  FieldMessage,
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
  Archive,
  CheckCircle2,
  FileClock,
  FilePlus2,
  ListChecks,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';

type AccountResponse = { data: LedgerAccount[] };
type JournalListResponse = { data: JournalSummary[] };
type JournalResponse = { data: JournalDetail };
type TaxCodeResponse = { data: TaxCode[] };
type TaxCalculationResponse = { data: TaxCalculationResult };

const accountTypes: readonly {
  value: LedgerAccountType;
  label: string;
  normal: LedgerNormalBalance;
}[] = [
  { value: 'ASSET', label: 'Asset', normal: 'DEBIT' },
  { value: 'LIABILITY', label: 'Liability', normal: 'CREDIT' },
  { value: 'EQUITY', label: 'Equity', normal: 'CREDIT' },
  { value: 'REVENUE', label: 'Revenue', normal: 'CREDIT' },
  { value: 'EXPENSE', label: 'Expense', normal: 'DEBIT' },
  { value: 'COST_OF_SALES', label: 'Cost of sales', normal: 'DEBIT' },
  { value: 'OTHER_INCOME', label: 'Other income', normal: 'CREDIT' },
  { value: 'OTHER_EXPENSE', label: 'Other expense', normal: 'DEBIT' },
];

type DraftLine = {
  key: string;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
  taxCodeId: string;
};

const blankLines = (): DraftLine[] => [
  {
    key: crypto.randomUUID(),
    accountId: '',
    description: '',
    debit: '',
    credit: '',
    taxCodeId: '',
  },
  {
    key: crypto.randomUUID(),
    accountId: '',
    description: '',
    debit: '',
    credit: '',
    taxCodeId: '',
  },
];

export function ChartOfAccountsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const currency = organization?.baseCurrency ?? 'KES';
  const canCreate = hasPermission(organization, 'accounts.create');
  const canUpdate = hasPermission(organization, 'accounts.update');
  const canDeactivate = hasPermission(organization, 'accounts.deactivate');
  const [accounts, setAccounts] = useState<LedgerAccount[] | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<LedgerAccount | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<AccountResponse>(
        `/organizations/${organizationId}/accounts`,
      );
      setAccounts(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Accounts could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts ?? [];
    return (accounts ?? []).filter((account) =>
      `${account.code} ${account.name} ${account.type}`.toLowerCase().includes(needle),
    );
  }, [accounts, query]);

  async function archive(account: LedgerAccount) {
    if (!organizationId) return;
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/accounts/${account.id}`, {
        method: 'DELETE',
      });
      setNotice(`${account.code} ${account.name} was archived.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That account could not be archived.');
    }
  }

  const columns: readonly DataTableColumn<LedgerAccount>[] = [
    {
      key: 'account',
      header: 'Account',
      cell: (account) => (
        <div>
          <strong>
            {account.code} {account.name}
          </strong>
          <span className="rb-table-secondary">{labelForAccountType(account.type)}</span>
        </div>
      ),
    },
    {
      key: 'normal',
      header: 'Normal',
      cell: (account) => account.normalBalance,
      hideBelow: 'tablet',
    },
    { key: 'status', header: 'Status', cell: (account) => <StatusBadge status={account.status} /> },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (account) => formatMinor(account.balanceMinor, currency),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (account) => (
        <div className="rb-ledger-row-actions">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/accounts/${account.id}/ledger`}>
              <FileClock aria-hidden="true" /> Ledger
            </Link>
          </Button>
          {account.status === 'ACTIVE' ? (
            <>
              {canUpdate ? (
                <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(account)}>
                  Edit
                </Button>
              ) : null}
              {canDeactivate ? (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => void archive(account)}
                >
                  <Archive aria-hidden="true" /> Archive
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description="A broad editable starter chart, scoped to this organization."
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setShowCreate((value) => !value)}>
              <Plus aria-hidden="true" /> Add account
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
        {notice ? (
          <div className="rb-auth-notice" role="status">
            {notice}
          </div>
        ) : null}

        {showCreate && canCreate ? (
          <AccountForm
            organizationId={organizationId}
            title="Add account"
            onSaved={(account) => {
              setNotice(`${account.code} ${account.name} was added.`);
              setShowCreate(false);
              void load();
            }}
          />
        ) : null}

        {editing && canUpdate ? (
          <AccountForm
            organizationId={organizationId}
            account={editing}
            title={`Edit ${editing.code}`}
            onCancel={() => setEditing(null)}
            onSaved={(account) => {
              setNotice(`${account.code} ${account.name} was updated.`);
              setEditing(null);
              void load();
            }}
          />
        ) : null}

        <Card className="rb-ledger-toolbar">
          <label className="rb-ledger-search">
            <Search aria-hidden="true" />
            <span className="rb-visually-hidden">Search accounts</span>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by code, name, or type..."
            />
          </label>
          <Badge>{filtered.length} accounts</Badge>
        </Card>

        {!accounts && !error ? (
          <div className="rb-security-loading" aria-label="Loading accounts">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : (
          <DataTable
            caption="Chart of accounts"
            columns={columns}
            rows={filtered}
            emptyTitle="No accounts match this filter"
            emptyDescription="Clear the search or add an account."
          />
        )}
      </div>
    </>
  );
}

function AccountForm({
  organizationId,
  title,
  account,
  onSaved,
  onCancel,
}: {
  organizationId: string | null;
  title: string;
  account?: LedgerAccount;
  onSaved: (account: LedgerAccount) => void;
  onCancel?: () => void;
}) {
  const [type, setType] = useState<LedgerAccountType>(account?.type ?? 'ASSET');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normal = accountTypes.find((candidate) => candidate.value === type)?.normal ?? 'DEBIT';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const payload = {
        code: formValue(data, 'code'),
        name: formValue(data, 'name'),
        type,
        normalBalance: normal,
        description: formValue(data, 'description') || undefined,
      };
      const response = await apiRequest<{ data: LedgerAccount }>(
        account
          ? `/organizations/${organizationId}/accounts/${account.id}`
          : `/organizations/${organizationId}/accounts`,
        { method: account ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
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
            <h2>{title}</h2>
            <p>Account codes stay unique inside this organization.</p>
          </div>
          <Badge tone="info">Normal {normal.toLowerCase()}</Badge>
        </div>
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="account-code">Code</Label>
            <Input id="account-code" name="code" defaultValue={account?.code} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="account-name">Name</Label>
            <Input id="account-name" name="name" defaultValue={account?.name} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="account-type">Type</Label>
            <Select
              id="account-type"
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value as LedgerAccountType)}
            >
              {accountTypes.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="account-description">Description</Label>
            <Input
              id="account-description"
              name="description"
              defaultValue={account?.description ?? ''}
            />
          </div>
        </div>
        <div className="rb-dialog-footer">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> Save account
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function JournalsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const currency = organization?.baseCurrency ?? 'KES';
  const canCreate = hasPermission(organization, 'journals.create');
  const [journals, setJournals] = useState<JournalSummary[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    const suffix = status ? `?status=${status}` : '';
    apiRequest<JournalListResponse>(`/organizations/${organizationId}/journals${suffix}`)
      .then((response) => {
        setJournals(response.data);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Journals could not be loaded.'),
      );
  }, [organizationId, status]);

  const columns: readonly DataTableColumn<JournalSummary>[] = [
    {
      key: 'journal',
      header: 'Journal',
      cell: (journal) => (
        <div>
          <strong>{journal.reference ?? 'Draft'}</strong>
          <span className="rb-table-secondary">{journal.description}</span>
        </div>
      ),
    },
    { key: 'date', header: 'Date', cell: (journal) => journal.journalDate, hideBelow: 'tablet' },
    { key: 'status', header: 'Status', cell: (journal) => <StatusBadge status={journal.status} /> },
    {
      key: 'amount',
      header: 'Debit',
      align: 'right',
      cell: (journal) => formatMinor(journal.debitMinor, currency),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (journal) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/journals/${journal.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Journals"
        description="Drafts stay editable; posted journals are corrected with reversals."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/journals/new">
                <FilePlus2 aria-hidden="true" /> New journal
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
            <Label htmlFor="journal-status">Status</Label>
            <Select
              id="journal-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All journals</option>
              <option value="DRAFT">Draft</option>
              <option value="POSTED">Posted</option>
              <option value="REVERSED">Reversed</option>
            </Select>
          </div>
          <Badge>{journals?.length ?? 0} journals</Badge>
        </Card>
        <DataTable
          caption="Journals"
          columns={columns}
          rows={journals ?? []}
          loading={!journals && !error}
          emptyTitle="No journals yet"
          emptyDescription="Create a balanced draft to begin the ledger."
        />
      </div>
    </>
  );
}

export function JournalEditorPage({ journalId }: { journalId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const currency = organization?.baseCurrency ?? 'KES';
  const canCreate = hasPermission(organization, 'journals.create');
  const canPost = hasPermission(organization, 'journals.post');
  const canReverse = hasPermission(organization, 'journals.reverse');
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [journal, setJournal] = useState<JournalDetail | null>(null);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(blankLines);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [accountResponse, taxCodeResponse, journalResponse] = await Promise.all([
        apiRequest<AccountResponse>(`/organizations/${organizationId}/accounts`),
        apiRequest<TaxCodeResponse>(`/organizations/${organizationId}/tax/codes`),
        journalId
          ? apiRequest<JournalResponse>(`/organizations/${organizationId}/journals/${journalId}`)
          : Promise.resolve(null),
      ]);
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      if (journalResponse) {
        setJournal(journalResponse.data);
        setDate(journalResponse.data.journalDate);
        setDescription(journalResponse.data.description);
        setLines(
          journalResponse.data.lines.map((line) => ({
            key: line.id,
            accountId: line.accountId,
            description: line.description ?? '',
            debit: minorToDecimal(line.debitMinor),
            credit: minorToDecimal(line.creditMinor),
            taxCodeId: line.taxCodeId ?? '',
          })),
        );
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The journal could not be loaded.');
    }
  }, [journalId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const debitMinor = lines.reduce(
      (total, line) => total + BigInt(decimalToMinor(line.debit || '0')),
      0n,
    );
    const creditMinor = lines.reduce(
      (total, line) => total + BigInt(decimalToMinor(line.credit || '0')),
      0n,
    );
    return { debitMinor, creditMinor, balanced: debitMinor > 0n && debitMinor === creditMinor };
  }, [lines]);

  const posted = journal?.status === 'POSTED' || journal?.status === 'REVERSED';
  const editable = !posted && canCreate;

  async function saveDraft() {
    if (!organizationId) return null;
    setBusy('save');
    setError(null);
    try {
      const payload = journalPayload(date, currency, description, lines);
      const response = await apiRequest<JournalResponse>(
        journalId
          ? `/organizations/${organizationId}/journals/${journalId}`
          : `/organizations/${organizationId}/journals`,
        { method: journalId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setJournal(response.data);
      setNotice('Draft saved.');
      if (!journalId) router.replace(`/journals/${response.data.id}`);
      return response.data;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The draft could not be saved.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function postJournal() {
    if (!organizationId || !journal?.id) return;
    setBusy('post');
    setError(null);
    try {
      const response = await apiRequest<JournalResponse>(
        `/organizations/${organizationId}/journals/${journal.id}/post`,
        { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setJournal(response.data);
      setNotice(`Posted as ${response.data.reference}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The journal could not be posted.');
    } finally {
      setBusy(null);
    }
  }

  async function reverseJournal() {
    if (!organizationId || !journal?.id) return;
    setBusy('reverse');
    setError(null);
    try {
      const response = await apiRequest<JournalResponse>(
        `/organizations/${organizationId}/journals/${journal.id}/reverse`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ description: `Reversal of ${journal.reference ?? journal.id}` }),
        },
      );
      setNotice(`Reversal posted as ${response.data.reference}.`);
      router.push(`/journals/${response.data.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The journal could not be reversed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title={journal?.reference ?? (journalId ? 'Journal' : 'New journal')}
        description={
          posted
            ? 'Posted journals are immutable. Use reversal for corrections.'
            : 'Build a balanced draft before posting.'
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/journals">Back to journals</Link>
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
        {journalId && !journal && !error ? <Skeleton /> : null}
        <Card className="rb-journal-editor">
          <div className="rb-journal-editor__meta">
            <div className="rb-field">
              <Label htmlFor="journal-date">Date</Label>
              <Input
                id="journal-date"
                type="date"
                value={date}
                disabled={!editable}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="journal-currency">Currency</Label>
              <Input id="journal-currency" value={currency} disabled />
            </div>
            {journal ? <StatusBadge status={journal.status} /> : null}
          </div>
          <div className="rb-field">
            <Label htmlFor="journal-description">Description</Label>
            <Textarea
              id="journal-description"
              value={description}
              disabled={!editable}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
          </div>

          <div className="rb-journal-lines" role="table" aria-label="Journal lines">
            <div className="rb-journal-lines__head" role="row">
              <span>Account</span>
              <span>Description</span>
              <span>Tax</span>
              <span>Debit</span>
              <span>Credit</span>
              <span />
            </div>
            {lines.map((line, index) => (
              <div className="rb-journal-lines__row" role="row" key={line.key}>
                <Select
                  aria-label={`Account for line ${index + 1}`}
                  value={line.accountId}
                  disabled={!editable}
                  onChange={(event) => updateLine(line.key, { accountId: event.target.value })}
                >
                  <option value="">Choose account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Description for line ${index + 1}`}
                  value={line.description}
                  disabled={!editable}
                  onChange={(event) => updateLine(line.key, { description: event.target.value })}
                />
                {editable ? (
                  <TaxLineControl
                    organizationId={organizationId}
                    line={line}
                    taxCodes={taxCodes}
                    onTaxCodeChange={(taxCodeId) => updateLine(line.key, { taxCodeId })}
                  />
                ) : (
                  <span className="rb-table-secondary">
                    {formatTaxSnapshot(journal?.lines.find((detail) => detail.id === line.key))}
                  </span>
                )}
                <Input
                  aria-label={`Debit for line ${index + 1}`}
                  inputMode="decimal"
                  value={line.debit}
                  disabled={!editable}
                  onChange={(event) =>
                    updateLine(line.key, {
                      debit: event.target.value,
                      credit: event.target.value ? '' : line.credit,
                    })
                  }
                />
                <Input
                  aria-label={`Credit for line ${index + 1}`}
                  inputMode="decimal"
                  value={line.credit}
                  disabled={!editable}
                  onChange={(event) =>
                    updateLine(line.key, {
                      credit: event.target.value,
                      debit: event.target.value ? '' : line.debit,
                    })
                  }
                />
                {editable ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={() => removeLine(line.key)}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>

          <div className="rb-journal-editor__footer">
            <div>
              <span>Debits {formatMinor(totals.debitMinor.toString(), currency)}</span>
              <span>Credits {formatMinor(totals.creditMinor.toString(), currency)}</span>
              <Badge tone={totals.balanced ? 'success' : 'warning'}>
                {totals.balanced ? 'Balanced' : 'Out of balance'}
              </Badge>
            </div>
            <div className="rb-dialog-footer">
              {editable ? (
                <>
                  <Button type="button" variant="outline" onClick={addLine}>
                    <Plus aria-hidden="true" /> Add line
                  </Button>
                  <Button type="button" onClick={() => void saveDraft()} loading={busy === 'save'}>
                    <Save aria-hidden="true" /> Save draft
                  </Button>
                </>
              ) : null}
              {journal?.status === 'DRAFT' && canPost ? (
                <Button
                  type="button"
                  onClick={() => void postJournal()}
                  loading={busy === 'post'}
                  disabled={!totals.balanced}
                >
                  <CheckCircle2 aria-hidden="true" /> Post
                </Button>
              ) : null}
              {journal?.status === 'POSTED' && canReverse ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void reverseJournal()}
                  loading={busy === 'reverse'}
                >
                  <RotateCcw aria-hidden="true" /> Reverse
                </Button>
              ) : null}
            </div>
          </div>
          {!totals.balanced ? (
            <FieldMessage error>Debits and credits must balance before posting.</FieldMessage>
          ) : null}
        </Card>
      </div>
    </>
  );

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        accountId: '',
        description: '',
        debit: '',
        credit: '',
        taxCodeId: '',
      },
    ]);
  }

  function removeLine(key: string) {
    setLines((current) =>
      current.length > 2 ? current.filter((line) => line.key !== key) : current,
    );
  }
}

export function TrialBalancePage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organizationId = workspace.activeOrganization?.id ?? null;
  const currency = workspace.activeOrganization?.baseCurrency ?? 'KES';
  const [asOf, setAsOf] = useState(today());
  const [report, setReport] = useState<TrialBalanceResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<TrialBalanceResponse>(
        `/organizations/${organizationId}/reports/trial-balance?asOf=${asOf}`,
      );
      setReport(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Trial balance could not be loaded.');
    }
  }, [asOf, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Trial balance"
        description="Debit and credit totals from posted ledger activity."
      />
      <div className="rb-ledger-stack">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="trial-as-of">As of</Label>
            <Input
              id="trial-as-of"
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
            />
          </div>
          <Badge tone={report?.totals.balanced ? 'success' : 'warning'}>
            {report?.totals.balanced ? 'Balanced' : 'Review'}
          </Badge>
        </Card>
        <div className="rb-table-scroll">
          <table className="rb-table rb-ledger-table">
            <caption className="rb-visually-hidden">Trial balance</caption>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th className="rb-table--right">Debit</th>
                <th className="rb-table--right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {report?.rows.map((row) => (
                <tr key={row.accountId}>
                  <td>
                    <strong>
                      {row.accountCode} {row.accountName}
                    </strong>
                  </td>
                  <td>{labelForAccountType(row.accountType)}</td>
                  <td className="rb-table--right rb-num">
                    {formatMinor(row.debitMinor, currency)}
                  </td>
                  <td className="rb-table--right rb-num">
                    {formatMinor(row.creditMinor, currency)}
                  </td>
                </tr>
              ))}
              {report ? (
                <tr className="rb-ledger-total-row">
                  <th scope="row" colSpan={2}>
                    Total
                  </th>
                  <td className="rb-table--right rb-num">
                    {formatMinor(report.totals.debitMinor, currency)}
                  </td>
                  <td className="rb-table--right rb-num">
                    {formatMinor(report.totals.creditMinor, currency)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function AccountLedgerPage({ accountId }: { accountId: string }) {
  const workspace = useWorkspace({ requireOrganization: true });
  const organizationId = workspace.activeOrganization?.id ?? null;
  const currency = workspace.activeOrganization?.baseCurrency ?? 'KES';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today());
  const [ledger, setLedger] = useState<AccountLedgerResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    try {
      const response = await apiRequest<AccountLedgerResponse>(
        `/organizations/${organizationId}/accounts/${accountId}/ledger?${params.toString()}`,
      );
      setLedger(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Account ledger could not be loaded.');
    }
  }, [accountId, from, organizationId, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title={ledger ? `${ledger.account.code} ${ledger.account.name}` : 'Account ledger'}
        description="Opening balance, posted movements, and closing balance for one account."
        actions={
          <Button asChild variant="outline">
            <Link href="/accounts">Back to accounts</Link>
          </Button>
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
            <Label htmlFor="ledger-from">From</Label>
            <Input
              id="ledger-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="ledger-to">To</Label>
            <Input
              id="ledger-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <Badge>Closing {formatMinor(ledger?.closingBalanceMinor ?? '0', currency)}</Badge>
        </Card>
        {ledger?.rows.length ? (
          <div className="rb-table-scroll">
            <table className="rb-table rb-ledger-table">
              <caption className="rb-visually-hidden">Account ledger movements</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Journal</th>
                  <th>Description</th>
                  <th className="rb-table--right">Debit</th>
                  <th className="rb-table--right">Credit</th>
                  <th className="rb-table--right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="rb-ledger-opening-row">
                  <td colSpan={5}>Opening balance</td>
                  <td className="rb-table--right rb-num">
                    {formatMinor(ledger.openingBalanceMinor, currency)}
                  </td>
                </tr>
                {ledger.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.journalDate}</td>
                    <td>
                      <Link href={`/journals/${row.journalId}`}>{row.reference ?? 'Journal'}</Link>
                    </td>
                    <td>{row.description}</td>
                    <td className="rb-table--right rb-num">
                      {formatMinor(row.debitMinor, currency)}
                    </td>
                    <td className="rb-table--right rb-num">
                      {formatMinor(row.creditMinor, currency)}
                    </td>
                    <td className="rb-table--right rb-num">
                      {formatMinor(row.balanceMinor, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={ListChecks}
            title="No posted movements"
            description="Posted journals that touch this account will appear here."
          />
        )}
      </div>
    </>
  );
}

function journalPayload(
  date: string,
  currency: string,
  description: string,
  lines: readonly DraftLine[],
) {
  return {
    journalDate: date,
    currency,
    description,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      description: line.description || undefined,
      debitMinor: decimalToMinor(line.debit || '0'),
      creditMinor: decimalToMinor(line.credit || '0'),
      taxCodeId: line.taxCodeId || undefined,
    })),
  };
}

function TaxLineControl({
  organizationId,
  line,
  taxCodes,
  onTaxCodeChange,
}: {
  organizationId: string | null;
  line: DraftLine;
  taxCodes: readonly TaxCode[];
  onTaxCodeChange: (taxCodeId: string) => void;
}) {
  const [preview, setPreview] = useState<TaxCalculationResult | null>(null);
  const amount = line.debit || line.credit;

  useEffect(() => {
    if (!organizationId || !line.taxCodeId || !amount) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiRequest<TaxCalculationResponse>(`/organizations/${organizationId}/tax/calculate`, {
        method: 'POST',
        body: JSON.stringify({ taxCodeId: line.taxCodeId, amountMinor: decimalToMinor(amount) }),
        signal: controller.signal,
      })
        .then((response) => setPreview(response.data))
        .catch(() => setPreview(null));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [organizationId, line.taxCodeId, amount]);

  return (
    <div className="rb-tax-line-control">
      <Select
        aria-label="Tax code"
        value={line.taxCodeId}
        onChange={(event) => onTaxCodeChange(event.target.value)}
      >
        <option value="">No tax</option>
        {taxCodes.map((code) => (
          <option key={code.id} value={code.id}>
            {code.code}
          </option>
        ))}
      </Select>
      {preview ? (
        <span className="rb-tax-line-control__preview">
          tax {preview.taxAmountMinor && `+${minorToDecimal(preview.taxAmountMinor)}`}
        </span>
      ) : null}
    </div>
  );
}

function formatTaxSnapshot(line?: JournalDetail['lines'][number]): string {
  if (!line?.taxCodeSnapshot) return 'No tax';
  const rate = line.taxRatePercentSnapshot ? `${line.taxRatePercentSnapshot}%` : '';
  return `${line.taxCodeSnapshot} ${rate}`.trim();
}

function decimalToMinor(value: string): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
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

function labelForAccountType(type: LedgerAccountType): string {
  return accountTypes.find((entry) => entry.value === type)?.label ?? type;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
