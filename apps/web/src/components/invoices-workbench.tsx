'use client';

import type { Contact, Invoice, InvoiceStatus, Item, TaxCode } from '@retailbooks/contracts';
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
import { CheckCircle2, FilePlus2, Save, Search, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type InvoiceListResponse = { data: Invoice[] };
type InvoiceResponse = { data: Invoice };
type ContactListResponse = { data: Contact[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };

const statusOptions: readonly InvoiceStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
];

type DraftLine = {
  key: string;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxCodeId: string;
};

const blankLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  itemId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discount: '',
  taxCodeId: '',
});

export function InvoicesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'sales.invoices.view');
  const canManage = hasPermission(organization, 'sales.invoices.manage');

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | InvoiceStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<InvoiceListResponse>(
        `/organizations/${organizationId}/invoices${suffix}`,
      );
      setInvoices(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invoices could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return invoices ?? [];
    return (invoices ?? []).filter((invoice) =>
      `${invoice.invoiceNumber ?? ''} ${invoice.contactName}`.toLowerCase().includes(needle),
    );
  }, [invoices, query]);

  const columns: readonly DataTableColumn<Invoice>[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      cell: (invoice) => (
        <div>
          <strong>{invoice.invoiceNumber ?? 'Draft'}</strong>
          <span className="rb-table-secondary">{invoice.contactName}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (invoice) => <StatusBadge status={invoice.status} /> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (invoice) => formatMinor(invoice.totalMinor, invoice.currency),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (invoice) => formatMinor(invoice.balanceMinor, invoice.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (invoice) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/invoices/${invoice.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant invoice access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Draft, issue, and void customer invoices."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/invoices/new">
                <FilePlus2 aria-hidden="true" /> New invoice
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
            <Label htmlFor="invoice-search">
              <Search aria-hidden="true" /> Search invoices
            </Label>
            <Input
              id="invoice-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by invoice number or customer..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="invoice-status">Status</Label>
            <Select
              id="invoice-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All invoices</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{invoices?.length ?? 0} invoices</Badge>
        </Card>

        {!invoices && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="Create your first invoice to start billing customers."
          />
        ) : (
          <DataTable caption="Invoices" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const INVOICE_FLASH_NOTICE_KEY = 'rb-invoice-notice';

export function InvoiceEditorPage({ invoiceId }: { invoiceId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'sales.invoices.manage');
  const canIssue = hasPermission(organization, 'sales.invoices.issue');
  const canVoid = hasPermission(organization, 'sales.invoices.void');

  const [customers, setCustomers] = useState<Contact[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [contactId, setContactId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [customerResponse, itemResponse, taxCodeResponse, invoiceResponse] = await Promise.all([
        apiRequest<ContactListResponse>(`/organizations/${organizationId}/customers?status=ACTIVE`),
        apiRequest<ItemListResponse>(
          `/organizations/${organizationId}/catalog/items?status=ACTIVE`,
        ),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        invoiceId
          ? apiRequest<InvoiceResponse>(`/organizations/${organizationId}/invoices/${invoiceId}`)
          : Promise.resolve(null),
      ]);
      setCustomers(customerResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      if (invoiceResponse) {
        setInvoice(invoiceResponse.data);
        setContactId(invoiceResponse.data.contactId);
        setDueDate(invoiceResponse.data.dueDate ?? '');
        setLines(
          invoiceResponse.data.lines.length > 0
            ? invoiceResponse.data.lines.map((line) => ({
                key: line.id,
                itemId: line.itemId ?? '',
                description: line.descriptionSnapshot,
                quantity: line.quantity,
                unitPrice: minorToDecimal(line.unitPriceMinor),
                discount: line.discountMinor === '0' ? '' : minorToDecimal(line.discountMinor),
                taxCodeId: line.taxCodeId ?? '',
              }))
            : [blankLine()],
        );
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invoice could not be loaded.');
    }
  }, [invoiceId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(INVOICE_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(INVOICE_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [invoiceId]);

  const contact = customers.find((candidate) => candidate.id === contactId) ?? null;
  const currency = contact?.currency ?? invoice?.currency ?? organization?.baseCurrency ?? 'KES';

  const subtotalPreviewMinor = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + previewLineTotalMinor(line.quantity, line.unitPrice, line.discount),
        0n,
      ),
    [lines],
  );

  const posted = invoice ? invoice.status !== 'DRAFT' : false;
  const editable = !posted && canManage;

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
    const price = item?.prices.find(
      (candidate) => candidate.priceListKey === 'default' && candidate.currency === currency,
    );
    updateLine(key, {
      itemId,
      description: item?.name ?? '',
      unitPrice: price ? minorToDecimal(price.unitPriceMinor) : '',
      taxCodeId: item?.defaultTaxCodeId ?? '',
    });
  }

  async function saveDraft() {
    if (!organizationId || !contactId) return null;
    setBusy('save');
    setError(null);
    try {
      const payload = {
        contactId,
        dueDate: dueDate || undefined,
        lines: lines.map((line) => {
          const item = items.find((candidate) => candidate.id === line.itemId);
          const descriptionEditable = !item || item.freeDescriptionAllowed;
          return {
            itemId: line.itemId || undefined,
            description: descriptionEditable ? line.description || undefined : undefined,
            quantity: line.quantity || '1',
            unitPriceMinor: line.unitPrice ? decimalToMinor(line.unitPrice) : undefined,
            discountMinor: line.discount ? decimalToMinor(line.discount) : undefined,
            taxCodeId: line.taxCodeId || undefined,
          };
        }),
      };
      const response = await apiRequest<InvoiceResponse>(
        invoiceId
          ? `/organizations/${organizationId}/invoices/${invoiceId}`
          : `/organizations/${organizationId}/invoices`,
        { method: invoiceId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setInvoice(response.data);
      if (!invoiceId) {
        window.sessionStorage.setItem(INVOICE_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/invoices/${response.data.id}`);
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

  async function issueInvoice() {
    if (!organizationId || !invoice?.id) return;
    setBusy('issue');
    setError(null);
    try {
      const response = await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/invoices/${invoice.id}/issue`,
        { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setInvoice(response.data);
      setNotice(`Issued as ${response.data.invoiceNumber}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invoice could not be issued.');
    } finally {
      setBusy(null);
    }
  }

  async function voidInvoice() {
    if (!organizationId || !invoice?.id) return;
    setBusy('void');
    setError(null);
    try {
      const response = await apiRequest<InvoiceResponse>(
        `/organizations/${organizationId}/invoices/${invoice.id}/void`,
        { method: 'POST' },
      );
      setInvoice(response.data);
      setNotice('Invoice voided.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invoice could not be voided.');
    } finally {
      setBusy(null);
    }
  }

  const canVoidNow =
    invoice &&
    (invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID') &&
    invoice.paidMinor === '0' &&
    canVoid;

  return (
    <>
      <PageHeader
        title={invoice?.invoiceNumber ?? (invoiceId ? 'Invoice' : 'New invoice')}
        description={
          posted
            ? 'Issued invoices are immutable. Void to reverse an unpaid invoice.'
            : 'Build a draft, then issue to post it to the ledger.'
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices">Back to invoices</Link>
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
        {invoiceId && !invoice && !error ? <Skeleton /> : null}

        <Card className="rb-journal-editor">
          <div className="rb-journal-editor__meta">
            <div className="rb-field">
              <Label htmlFor="invoice-customer">Customer</Label>
              <Select
                id="invoice-customer"
                value={contactId}
                disabled={!editable}
                onChange={(event) => setContactId(event.target.value)}
              >
                <option value="">Choose customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="rb-field">
              <Label htmlFor="invoice-due-date">Due date</Label>
              <Input
                id="invoice-due-date"
                type="date"
                value={dueDate}
                disabled={!editable}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="invoice-currency">Currency</Label>
              <Input id="invoice-currency" value={currency} disabled />
            </div>
            {invoice ? <StatusBadge status={invoice.status} /> : null}
          </div>

          <div className="rb-journal-lines" role="table" aria-label="Invoice lines">
            <div className="rb-journal-lines__head" role="row">
              <span>Item</span>
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span>Discount</span>
              <span>Tax</span>
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
                    disabled={!editable}
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
                    disabled={!editable || Boolean(item && !item.freeDescriptionAllowed)}
                    onChange={(event) => updateLine(line.key, { description: event.target.value })}
                  />
                  <Input
                    aria-label={`Quantity for line ${index + 1}`}
                    inputMode="decimal"
                    value={line.quantity}
                    disabled={!editable}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  />
                  <Input
                    aria-label={`Unit price for line ${index + 1}`}
                    inputMode="decimal"
                    value={line.unitPrice}
                    disabled={!editable}
                    onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                  />
                  <Input
                    aria-label={`Discount for line ${index + 1}`}
                    inputMode="decimal"
                    value={line.discount}
                    disabled={!editable}
                    onChange={(event) => updateLine(line.key, { discount: event.target.value })}
                  />
                  <Select
                    aria-label={`Tax code for line ${index + 1}`}
                    value={line.taxCodeId}
                    disabled={!editable}
                    onChange={(event) => updateLine(line.key, { taxCodeId: event.target.value })}
                  >
                    <option value="">No tax</option>
                    {taxCodes.map((code) => (
                      <option key={code.id} value={code.id}>
                        {code.code}
                      </option>
                    ))}
                  </Select>
                  <span className="rb-table-secondary rb-num">
                    {formatMinor(lineTotalMinor.toString(), currency)}
                  </span>
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => removeLine(line.key)}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <XCircle aria-hidden="true" />
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>

          <div className="rb-journal-editor__footer">
            <div>
              <span>Subtotal {formatMinor(subtotalPreviewMinor.toString(), currency)}</span>
              {invoice && invoice.status !== 'DRAFT' ? (
                <>
                  <span>Tax {formatMinor(invoice.taxTotalMinor, currency)}</span>
                  <span>Total {formatMinor(invoice.totalMinor, currency)}</span>
                  <span>Balance {formatMinor(invoice.balanceMinor, currency)}</span>
                </>
              ) : (
                <Badge tone="info">Tax is calculated when the invoice is issued</Badge>
              )}
            </div>
            <div className="rb-dialog-footer">
              {editable ? (
                <>
                  <Button type="button" variant="outline" onClick={addLine}>
                    Add line
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void saveDraft()}
                    loading={busy === 'save'}
                    disabled={!contactId}
                  >
                    <Save aria-hidden="true" /> Save draft
                  </Button>
                </>
              ) : null}
              {invoice?.status === 'DRAFT' && canIssue ? (
                <Button
                  type="button"
                  onClick={() => void issueInvoice()}
                  loading={busy === 'issue'}
                >
                  <CheckCircle2 aria-hidden="true" /> Issue
                </Button>
              ) : null}
              {canVoidNow ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void voidInvoice()}
                  loading={busy === 'void'}
                >
                  <XCircle aria-hidden="true" /> Void
                </Button>
              ) : null}
            </div>
          </div>
          {!contactId && editable ? (
            <FieldMessage error>Choose a customer before saving this invoice.</FieldMessage>
          ) : null}
        </Card>
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
