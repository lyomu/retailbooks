'use client';

import type {
  LedgerAccount,
  TaxCalculationResult,
  TaxCode,
  TaxRate,
  TaxTreatment,
} from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@retailbooks/ui';
import { Calculator, Plus, Save, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';

type AccountResponse = { data: LedgerAccount[] };
type TaxCodeResponse = { data: TaxCode[] };
type TaxRateResponse = { data: TaxRate[] };
type TaxCalculationResponse = { data: TaxCalculationResult };

const treatments: readonly { value: TaxTreatment; label: string }[] = [
  { value: 'EXCLUSIVE', label: 'Exclusive (tax added on top)' },
  { value: 'INCLUSIVE', label: 'Inclusive (tax already included)' },
];

export function TaxCodesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'tax.codes.manage');
  const [codes, setCodes] = useState<TaxCode[] | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<TaxCode | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [codeResponse, accountResponse] = await Promise.all([
        apiRequest<TaxCodeResponse>(`/organizations/${organizationId}/tax/codes`),
        apiRequest<AccountResponse>(`/organizations/${organizationId}/accounts`),
      ]);
      setCodes(codeResponse.data);
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tax codes could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return codes ?? [];
    return (codes ?? []).filter((code) =>
      `${code.code} ${code.name} ${code.treatment}`.toLowerCase().includes(needle),
    );
  }, [codes, query]);

  const selectedCode = codes?.find((code) => code.id === selectedCodeId) ?? null;

  async function archive(code: TaxCode) {
    if (!organizationId) return;
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/tax/codes/${code.id}`, {
        method: 'DELETE',
      });
      setNotice(`${code.code} was archived.`);
      if (selectedCodeId === code.id) setSelectedCodeId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That tax code could not be archived.');
    }
  }

  const columns: readonly DataTableColumn<TaxCode>[] = [
    {
      key: 'code',
      header: 'Tax code',
      cell: (code) => (
        <div>
          <strong>
            {code.code} {code.name}
          </strong>
          <span className="rb-table-secondary">
            {treatments.find((entry) => entry.value === code.treatment)?.label ?? code.treatment}
          </span>
        </div>
      ),
    },
    {
      key: 'recoverable',
      header: 'Recoverable',
      cell: (code) => (
        <Badge tone={code.recoverable ? 'success' : 'neutral'}>
          {code.recoverable ? 'Yes' : 'No'}
        </Badge>
      ),
      hideBelow: 'tablet',
    },
    {
      key: 'rate',
      header: 'Current rate',
      align: 'right',
      cell: (code) => (code.currentRatePercent ? `${code.currentRatePercent}%` : 'No active rate'),
    },
    { key: 'status', header: 'Status', cell: (code) => <StatusBadge status={code.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (code) => (
        <div className="rb-ledger-row-actions">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setSelectedCodeId(selectedCodeId === code.id ? null : code.id)}
          >
            Rates
          </Button>
          {canManage && code.status === 'ACTIVE' ? (
            <>
              <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(code)}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => void archive(code)}>
                <Trash2 aria-hidden="true" /> Archive
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Tax codes"
        description="Effective-dated tax codes and rates for this organization. Configurable defaults, not certified statutory rates."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setShowCreate((value) => !value)}>
              <Plus aria-hidden="true" /> Add tax code
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

        {showCreate && canManage ? (
          <TaxCodeForm
            organizationId={organizationId}
            accounts={accounts}
            title="Add tax code"
            onSaved={(code) => {
              setNotice(`${code.code} ${code.name} was added.`);
              setShowCreate(false);
              void load();
            }}
          />
        ) : null}

        {editing && canManage ? (
          <TaxCodeForm
            organizationId={organizationId}
            accounts={accounts}
            code={editing}
            title={`Edit ${editing.code}`}
            onCancel={() => setEditing(null)}
            onSaved={(code) => {
              setNotice(`${code.code} ${code.name} was updated.`);
              setEditing(null);
              void load();
            }}
          />
        ) : null}

        <Card className="rb-ledger-toolbar">
          <label className="rb-ledger-search">
            <Search aria-hidden="true" />
            <span className="rb-visually-hidden">Search tax codes</span>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by code, name, or treatment..."
            />
          </label>
          <Badge>{filtered.length} tax codes</Badge>
        </Card>

        {!codes && !error ? (
          <div className="rb-security-loading" aria-label="Loading tax codes">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : (
          <DataTable
            caption="Tax codes"
            columns={columns}
            rows={filtered}
            emptyTitle="No tax codes match this filter"
            emptyDescription="Clear the search or add a tax code."
          />
        )}

        {selectedCode ? (
          <TaxRatePanel
            organizationId={organizationId}
            code={selectedCode}
            canManage={canManage}
            currency={organization?.baseCurrency ?? 'KES'}
            onRateAdded={() => void load()}
          />
        ) : null}
      </div>
    </>
  );
}

function TaxCodeForm({
  organizationId,
  accounts,
  title,
  code,
  onSaved,
  onCancel,
}: {
  organizationId: string | null;
  accounts: LedgerAccount[];
  title: string;
  code?: TaxCode;
  onSaved: (code: TaxCode) => void;
  onCancel?: () => void;
}) {
  const [treatment, setTreatment] = useState<TaxTreatment>(code?.treatment ?? 'EXCLUSIVE');
  const [recoverable, setRecoverable] = useState(code?.recoverable ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...(code ? {} : { code: formValue(data, 'code') }),
        name: formValue(data, 'name'),
        treatment,
        recoverable,
        description: formValue(data, 'description') || undefined,
        salesTaxAccountId: formValue(data, 'salesTaxAccountId') || undefined,
        purchaseTaxAccountId: formValue(data, 'purchaseTaxAccountId') || undefined,
      };
      const response = await apiRequest<{ data: TaxCode }>(
        code
          ? `/organizations/${organizationId}/tax/codes/${code.id}`
          : `/organizations/${organizationId}/tax/codes`,
        { method: code ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      onSaved(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The tax code could not be saved.');
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
            <p>Tax codes stay unique inside this organization.</p>
          </div>
        </div>
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="rb-field-grid">
          {!code ? (
            <div className="rb-field">
              <Label htmlFor="tax-code-code">Code</Label>
              <Input id="tax-code-code" name="code" required />
            </div>
          ) : null}
          <div className="rb-field">
            <Label htmlFor="tax-code-name">Name</Label>
            <Input id="tax-code-name" name="name" defaultValue={code?.name} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="tax-code-treatment">Treatment</Label>
            <Select
              id="tax-code-treatment"
              value={treatment}
              onChange={(event) => setTreatment(event.target.value as TaxTreatment)}
            >
              {treatments.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="tax-code-description">Description</Label>
            <Input
              id="tax-code-description"
              name="description"
              defaultValue={code?.description ?? ''}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="tax-code-sales-account">Sales (output) tax account</Label>
            <Select
              id="tax-code-sales-account"
              name="salesTaxAccountId"
              defaultValue={code?.salesTaxAccountId ?? ''}
            >
              <option value="">None</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="tax-code-purchase-account">Purchase (input) tax account</Label>
            <Select
              id="tax-code-purchase-account"
              name="purchaseTaxAccountId"
              defaultValue={code?.purchaseTaxAccountId ?? ''}
            >
              <option value="">None</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <label className="rb-toggle-row">
          <input
            type="checkbox"
            checked={recoverable}
            onChange={(event) => setRecoverable(event.target.checked)}
          />
          <span>Input tax on this code is recoverable</span>
        </label>
        <div className="rb-dialog-footer">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> Save tax code
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TaxRatePanel({
  organizationId,
  code,
  canManage,
  currency,
  onRateAdded,
}: {
  organizationId: string | null;
  code: TaxCode;
  canManage: boolean;
  currency: string;
  onRateAdded: () => void;
}) {
  const [rates, setRates] = useState<TaxRate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadRates = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<TaxRateResponse>(
        `/organizations/${organizationId}/tax/codes/${code.id}/rates`,
      );
      setRates(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rates could not be loaded.');
    }
  }, [code.id, organizationId]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  async function submitRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ratePercent: formValue(data, 'ratePercent'),
        effectiveFrom: formValue(data, 'effectiveFrom'),
        effectiveTo: formValue(data, 'effectiveTo') || undefined,
      };
      await apiRequest(`/organizations/${organizationId}/tax/codes/${code.id}/rates`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      (event.target as HTMLFormElement).reset();
      await loadRates();
      onRateAdded();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The rate could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <div className="rb-ledger-form__heading">
        <div>
          <h2>{code.code} rate history</h2>
          <p>Rates are effective-dated. A new period is a new row; existing rates never change.</p>
        </div>
      </div>
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="rb-table-scroll">
        <table className="rb-table rb-ledger-table">
          <caption className="rb-visually-hidden">{code.code} rate history</caption>
          <thead>
            <tr>
              <th>Rate</th>
              <th>Effective from</th>
              <th>Effective to</th>
            </tr>
          </thead>
          <tbody>
            {rates?.map((rate) => (
              <tr key={rate.id}>
                <td className="rb-num">{rate.ratePercent}%</td>
                <td>{rate.effectiveFrom}</td>
                <td>{rate.effectiveTo ?? 'Open-ended'}</td>
              </tr>
            ))}
            {rates && rates.length === 0 ? (
              <tr>
                <td colSpan={3}>No rates yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <form className="rb-ledger-form" onSubmit={(event) => void submitRate(event)}>
          <div className="rb-field-grid">
            <div className="rb-field">
              <Label htmlFor="rate-percent">Rate percent</Label>
              <Input id="rate-percent" name="ratePercent" inputMode="decimal" required />
            </div>
            <div className="rb-field">
              <Label htmlFor="rate-from">Effective from</Label>
              <Input id="rate-from" name="effectiveFrom" type="date" required />
            </div>
            <div className="rb-field">
              <Label htmlFor="rate-to">Effective to (optional)</Label>
              <Input id="rate-to" name="effectiveTo" type="date" />
            </div>
          </div>
          <div className="rb-dialog-footer">
            <Button type="submit" loading={saving}>
              <Plus aria-hidden="true" /> Add rate
            </Button>
          </div>
        </form>
      ) : null}

      <TaxCalculationPreview organizationId={organizationId} code={code} currency={currency} />
    </Card>
  );
}

function TaxCalculationPreview({
  organizationId,
  code,
  currency,
}: {
  organizationId: string | null;
  code: TaxCode;
  currency: string;
}) {
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<TaxCalculationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<TaxCalculationResponse>(
        `/organizations/${organizationId}/tax/calculate`,
        {
          method: 'POST',
          body: JSON.stringify({ taxCodeId: code.id, amountMinor: decimalToMinor(amount || '0') }),
        },
      );
      setResult(response.data);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That amount could not be calculated.',
      );
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rb-tax-calculator">
      <h3>
        <Calculator aria-hidden="true" /> Try a calculation
      </h3>
      <form className="rb-tax-calculator__form" onSubmit={(event) => void calculate(event)}>
        <div className="rb-field">
          <Label htmlFor="calc-amount">
            {code.treatment === 'INCLUSIVE' ? 'Total amount' : 'Base amount'}
          </Label>
          <Input
            id="calc-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </div>
        <Button type="submit" variant="outline" loading={busy}>
          Calculate
        </Button>
      </form>
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {result ? (
        <dl className="rb-tax-calculator__result">
          <div>
            <dt>Taxable amount</dt>
            <dd>{formatMinor(result.taxableAmountMinor, currency)}</dd>
          </div>
          <div>
            <dt>Tax ({result.ratePercent}%)</dt>
            <dd>{formatMinor(result.taxAmountMinor, currency)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatMinor(result.totalAmountMinor, currency)}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

function decimalToMinor(value: string): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
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
