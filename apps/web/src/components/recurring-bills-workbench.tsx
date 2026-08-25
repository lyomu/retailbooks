'use client';

import type {
  Item,
  LedgerAccount,
  RecurringBillTemplate,
  RecurringCadence,
  TaxCode,
  Vendor,
} from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@retailbooks/ui';
import { Play, Plus, Save, Search, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type TemplateListResponse = { data: RecurringBillTemplate[] };
type VendorListResponse = { data: Vendor[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };
type AccountListResponse = { data: LedgerAccount[] };

const cadenceOptions: readonly RecurringCadence[] = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'];

type DraftLine = {
  key: string;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxCodeId: string;
  accountId: string;
};

const blankLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  itemId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discount: '',
  taxCodeId: '',
  accountId: '',
});

export function RecurringBillsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'purchases.recurring_bills.view');
  const canManage = hasPermission(organization, 'purchases.recurring_bills.manage');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [templates, setTemplates] = useState<RecurringBillTemplate[] | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<RecurringBillTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [vendorId, setVendorId] = useState('');
  const [cadence, setCadence] = useState<RecurringCadence>('MONTHLY');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [autoCreate, setAutoCreate] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [vendorResponse, itemResponse, taxCodeResponse, accountResponse, templateResponse] =
        await Promise.all([
          apiRequest<VendorListResponse>(`/organizations/${organizationId}/vendors?status=ACTIVE`),
          apiRequest<ItemListResponse>(
            `/organizations/${organizationId}/catalog/items?status=ACTIVE`,
          ),
          apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
          apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
          apiRequest<TemplateListResponse>(`/organizations/${organizationId}/recurring-bills`),
        ]);
      setVendors(vendorResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setTemplates(templateResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Recurring bills could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return templates ?? [];
    return (templates ?? []).filter((template) =>
      template.vendorName.toLowerCase().includes(needle),
    );
  }, [templates, query]);

  const currency = vendors.find((vendor) => vendor.id === vendorId)?.currency ?? 'KES';

  function resetForm() {
    setVendorId('');
    setCadence('MONTHLY');
    setStartDate(new Date().toISOString().slice(0, 10));
    setEndDate('');
    setAutoCreate(true);
    setLines([blankLine()]);
  }

  function openCreate() {
    resetForm();
    setEditing(null);
    setShowCreate(true);
  }

  function openEdit(template: RecurringBillTemplate) {
    setEditing(template);
    setShowCreate(false);
    setVendorId(template.vendorId);
    setCadence(template.cadence);
    setEndDate(template.endDate ?? '');
    setAutoCreate(template.autoCreate);
    setLines(
      template.lines.map((line) => ({
        key: line.id,
        itemId: line.itemId ?? '',
        description: line.descriptionSnapshot,
        quantity: line.quantity,
        unitPrice: minorToDecimal(line.unitPriceMinor),
        discount: line.discountMinor === '0' ? '' : minorToDecimal(line.discountMinor),
        taxCodeId: line.taxCodeId ?? '',
        accountId: line.accountId ?? '',
      })),
    );
  }

  function closeForm() {
    setEditing(null);
    setShowCreate(false);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, blankLine()]);
  }

  function removeLine(key: string) {
    setLines((current) =>
      current.length > 1 ? current.filter((line) => line.key !== key) : current,
    );
  }

  function selectItem(key: string, itemId: string) {
    if (!itemId) {
      updateLine(key, { itemId: '' });
      return;
    }
    const item = items.find((candidate) => candidate.id === itemId);
    updateLine(key, {
      itemId,
      description: item?.name ?? '',
      taxCodeId: item?.defaultTaxCodeId ?? '',
    });
  }

  async function submit() {
    if (!organizationId || !vendorId) return;
    setBusy('save');
    setError(null);
    try {
      const payload = {
        vendorId,
        cadence,
        startDate,
        endDate: endDate || undefined,
        autoCreate,
        lines: lines.map((line) => {
          const item = items.find((candidate) => candidate.id === line.itemId);
          const descriptionEditable = !item || item.freeDescriptionAllowed;
          return {
            itemId: line.itemId || undefined,
            description: descriptionEditable ? line.description || undefined : undefined,
            quantity: line.quantity || '1',
            unitPriceMinor: decimalToMinor(line.unitPrice || '0'),
            discountMinor: line.discount ? decimalToMinor(line.discount) : undefined,
            taxCodeId: line.taxCodeId || undefined,
            accountId: line.accountId || undefined,
          };
        }),
      };
      if (editing) {
        await apiRequest(`/organizations/${organizationId}/recurring-bills/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setNotice('Template updated.');
      } else {
        await apiRequest(`/organizations/${organizationId}/recurring-bills`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice('Template created.');
      }
      closeForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The template could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function setActive(template: RecurringBillTemplate, active: boolean) {
    if (!organizationId) return;
    setError(null);
    try {
      const action = active ? 'reactivate' : 'deactivate';
      await apiRequest(
        `/organizations/${organizationId}/recurring-bills/${template.id}/${action}`,
        {
          method: 'POST',
        },
      );
      setNotice(`Template ${active ? 'reactivated' : 'deactivated'}.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The template status could not be changed.',
      );
    }
  }

  async function runDueTemplates() {
    if (!organizationId) return;
    setBusy('run-due');
    setError(null);
    try {
      const response = await apiRequest<{ data: { templateId: string; billId: string | null }[] }>(
        `/organizations/${organizationId}/recurring-bills/run-due`,
        { method: 'POST' },
      );
      setNotice(`Generated ${response.data.length} bill(s) from due templates.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Due templates could not be run.');
    } finally {
      setBusy(null);
    }
  }

  const columns: readonly DataTableColumn<RecurringBillTemplate>[] = [
    { key: 'vendor', header: 'Vendor', cell: (template) => template.vendorName },
    { key: 'cadence', header: 'Cadence', cell: (template) => template.cadence },
    { key: 'nextRun', header: 'Next run', cell: (template) => template.nextRunDate },
    {
      key: 'status',
      header: 'Status',
      cell: (template) => <StatusBadge status={template.active ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (template) =>
        canManage ? (
          <div className="rb-inline-actions">
            <Button variant="ghost" size="sm" onClick={() => openEdit(template)}>
              Edit
            </Button>
            {template.active ? (
              <Button variant="ghost" size="sm" onClick={() => void setActive(template, false)}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void setActive(template, true)}>
                Reactivate
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant recurring bill access." />
    );
  }

  const formTarget = editing;
  const formOpen = showCreate || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Recurring bills"
        description="Templates that generate bills on a schedule."
        actions={
          canManage ? (
            <div className="rb-inline-actions">
              <Button
                variant="outline"
                onClick={() => void runDueTemplates()}
                loading={busy === 'run-due'}
              >
                <Play aria-hidden="true" /> Run due templates now
              </Button>
              <Button onClick={openCreate}>
                <Plus aria-hidden="true" /> New template
              </Button>
            </div>
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

        {formOpen ? (
          <Card className="rb-journal-editor">
            <div className="rb-journal-editor__meta">
              <div className="rb-field">
                <Label htmlFor="rb-template-vendor">Vendor</Label>
                <Select
                  id="rb-template-vendor"
                  value={vendorId}
                  onChange={(event) => setVendorId(event.target.value)}
                >
                  <option value="">Choose vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.displayName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="rb-template-cadence">Cadence</Label>
                <Select
                  id="rb-template-cadence"
                  value={cadence}
                  onChange={(event) => setCadence(event.target.value as RecurringCadence)}
                >
                  {cadenceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="rb-template-start-date">Start date</Label>
                <Input
                  id="rb-template-start-date"
                  type="date"
                  value={startDate}
                  disabled={Boolean(formTarget)}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="rb-template-end-date">End date (optional)</Label>
                <Input
                  id="rb-template-end-date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="rb-template-auto-create">
                  <input
                    id="rb-template-auto-create"
                    type="checkbox"
                    checked={autoCreate}
                    onChange={(event) => setAutoCreate(event.target.checked)}
                  />{' '}
                  Auto-issue when due (otherwise leaves a draft for review)
                </Label>
              </div>
            </div>

            <div className="rb-journal-lines" role="table" aria-label="Template lines">
              <div className="rb-journal-lines__head" role="row">
                <span>Item</span>
                <span>Description</span>
                <span>Qty</span>
                <span>Unit price</span>
                <span>Discount</span>
                <span>Tax</span>
                <span>Account</span>
                <span>Line total</span>
                <span />
              </div>
              {lines.map((line, index) => {
                const item = items.find((candidate) => candidate.id === line.itemId);
                const lineTotalMinor = previewLineTotalMinor(
                  line.quantity,
                  line.unitPrice,
                  line.discount,
                );
                return (
                  <div className="rb-journal-lines__row" role="row" key={line.key}>
                    <Select
                      aria-label={`Item for line ${index + 1}`}
                      value={line.itemId}
                      onChange={(event) => selectItem(line.key, event.target.value)}
                    >
                      <option value="">Free-text line</option>
                      {items.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.sku ? `${candidate.sku} ${candidate.name}` : candidate.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label={`Description for line ${index + 1}`}
                      value={line.description}
                      disabled={Boolean(item && !item.freeDescriptionAllowed)}
                      onChange={(event) =>
                        updateLine(line.key, { description: event.target.value })
                      }
                    />
                    <Input
                      aria-label={`Quantity for line ${index + 1}`}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    />
                    <Input
                      aria-label={`Unit price for line ${index + 1}`}
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                    />
                    <Input
                      aria-label={`Discount for line ${index + 1}`}
                      inputMode="decimal"
                      value={line.discount}
                      onChange={(event) => updateLine(line.key, { discount: event.target.value })}
                    />
                    <Select
                      aria-label={`Tax code for line ${index + 1}`}
                      value={line.taxCodeId}
                      onChange={(event) => updateLine(line.key, { taxCodeId: event.target.value })}
                    >
                      <option value="">No tax</option>
                      {taxCodes.map((code) => (
                        <option key={code.id} value={code.id}>
                          {code.code}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label={`Account for line ${index + 1}`}
                      value={line.accountId}
                      onChange={(event) => updateLine(line.key, { accountId: event.target.value })}
                    >
                      <option value="">Default expense account</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} {account.name}
                        </option>
                      ))}
                    </Select>
                    <span className="rb-table-secondary rb-num">
                      {formatMinor(lineTotalMinor.toString(), currency)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => removeLine(line.key)}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <XCircle aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="rb-dialog-footer">
              <Button type="button" variant="outline" onClick={addLine}>
                Add line
              </Button>
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submit()}
                loading={busy === 'save'}
                disabled={!vendorId}
              >
                <Save aria-hidden="true" /> Save template
              </Button>
            </div>
          </Card>
        ) : null}

        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="rb-template-search">
              <Search aria-hidden="true" /> Search templates
            </Label>
            <Input
              id="rb-template-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by vendor..."
            />
          </div>
          <Badge>{templates?.length ?? 0} templates</Badge>
        </Card>

        {!templates && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No recurring templates yet"
            description="Create a template to generate bills on a schedule."
          />
        ) : (
          <DataTable caption="Recurring bills" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

function previewLineTotalMinor(quantity: string, unitPrice: string, discount: string): bigint {
  const quantityMinor = BigInt(decimalToMinor(quantity || '0', 4));
  const unitPriceMinor = BigInt(decimalToMinor(unitPrice || '0'));
  const discountMinor = BigInt(decimalToMinor(discount || '0'));
  const gross = (quantityMinor * unitPriceMinor) / 10_000n;
  const total = gross - discountMinor;
  return total > 0n ? total : 0n;
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
