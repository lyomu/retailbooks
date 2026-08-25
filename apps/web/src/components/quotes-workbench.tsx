'use client';

import type { Contact, Item, Quote, QuoteStatus, TaxCode } from '@retailbooks/contracts';
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

type QuoteListResponse = { data: Quote[] };
type QuoteResponse = { data: Quote };
type ContactListResponse = { data: Contact[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };

const statusOptions: readonly QuoteStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CONVERTED',
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

export function QuotesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'sales.quotes.view');
  const canManage = hasPermission(organization, 'sales.quotes.manage');

  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | QuoteStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<QuoteListResponse>(
        `/organizations/${organizationId}/quotes${suffix}`,
      );
      setQuotes(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Quotes could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return quotes ?? [];
    return (quotes ?? []).filter((quote) =>
      `${quote.quoteNumber ?? ''} ${quote.contactName}`.toLowerCase().includes(needle),
    );
  }, [quotes, query]);

  const columns: readonly DataTableColumn<Quote>[] = [
    {
      key: 'quote',
      header: 'Quote',
      cell: (quote) => (
        <div>
          <strong>{quote.quoteNumber ?? 'Draft'}</strong>
          <span className="rb-table-secondary">{quote.contactName}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (quote) => <StatusBadge status={quote.status} /> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (quote) => formatMinor(quote.totalMinor, quote.currency),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (quote) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/quotes/${quote.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or sales manager to grant quote access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Quotes"
        description="Draft, send, and convert customer quotes."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/quotes/new">
                <FilePlus2 aria-hidden="true" /> New quote
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
            <Label htmlFor="quote-search">
              <Search aria-hidden="true" /> Search quotes
            </Label>
            <Input
              id="quote-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by quote number or customer..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="quote-status">Status</Label>
            <Select
              id="quote-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All quotes</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{quotes?.length ?? 0} quotes</Badge>
        </Card>

        {!quotes && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState title="No quotes yet" description="Create your first quote for a customer." />
        ) : (
          <DataTable caption="Quotes" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const QUOTE_FLASH_NOTICE_KEY = 'rb-quote-notice';

export function QuoteEditorPage({ quoteId }: { quoteId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'sales.quotes.manage');
  const canApprove = hasPermission(organization, 'sales.quotes.approve');
  const canConvert = hasPermission(organization, 'sales.quotes.convert');

  const [customers, setCustomers] = useState<Contact[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [contactId, setContactId] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [customerResponse, itemResponse, taxCodeResponse, quoteResponse] = await Promise.all([
        apiRequest<ContactListResponse>(`/organizations/${organizationId}/customers?status=ACTIVE`),
        apiRequest<ItemListResponse>(`/organizations/${organizationId}/catalog/items?status=ACTIVE`),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        quoteId
          ? apiRequest<QuoteResponse>(`/organizations/${organizationId}/quotes/${quoteId}`)
          : Promise.resolve(null),
      ]);
      setCustomers(customerResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      if (quoteResponse) {
        setQuote(quoteResponse.data);
        setContactId(quoteResponse.data.contactId);
        setExpiryDate(quoteResponse.data.expiryDate ?? '');
        setLines(
          quoteResponse.data.lines.length > 0
            ? quoteResponse.data.lines.map((line) => ({
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
      setError(caught instanceof Error ? caught.message : 'The quote could not be loaded.');
    }
  }, [organizationId, quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(QUOTE_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(QUOTE_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [quoteId]);

  const contact = customers.find((candidate) => candidate.id === contactId) ?? null;
  const currency = contact?.currency ?? quote?.currency ?? organization?.baseCurrency ?? 'KES';

  const subtotalPreviewMinor = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + previewLineTotalMinor(line.quantity, line.unitPrice, line.discount),
        0n,
      ),
    [lines],
  );

  const editable = (quote ? quote.status === 'DRAFT' : true) && canManage;

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
        expiryDate: expiryDate || undefined,
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
      const response = await apiRequest<QuoteResponse>(
        quoteId
          ? `/organizations/${organizationId}/quotes/${quoteId}`
          : `/organizations/${organizationId}/quotes`,
        { method: quoteId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setQuote(response.data);
      if (!quoteId) {
        window.sessionStorage.setItem(QUOTE_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/quotes/${response.data.id}`);
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

  async function transition(action: string, noticeText: string) {
    if (!organizationId || !quote?.id) return;
    setBusy(action);
    setError(null);
    try {
      const response = await apiRequest<QuoteResponse>(
        `/organizations/${organizationId}/quotes/${quote.id}/${action}`,
        { method: 'POST' },
      );
      setQuote(response.data);
      setNotice(noticeText);
      if (action === 'convert' && response.data.convertedInvoiceId) {
        router.push(`/invoices/${response.data.convertedInvoiceId}`);
        return;
      }
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action could not be completed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title={quote?.quoteNumber ?? (quoteId ? 'Quote' : 'New quote')}
        description="Build a quote, submit it for approval, then send it to the customer."
        actions={
          <Button asChild variant="outline">
            <Link href="/quotes">Back to quotes</Link>
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
        {quoteId && !quote && !error ? <Skeleton /> : null}

        <Card className="rb-journal-editor">
          <div className="rb-journal-editor__meta">
            <div className="rb-field">
              <Label htmlFor="quote-customer">Customer</Label>
              <Select
                id="quote-customer"
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
              <Label htmlFor="quote-expiry-date">Expiry date</Label>
              <Input
                id="quote-expiry-date"
                type="date"
                value={expiryDate}
                disabled={!editable}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="quote-currency">Currency</Label>
              <Input id="quote-currency" value={currency} disabled />
            </div>
            {quote ? <StatusBadge status={quote.status} /> : null}
          </div>

          <div className="rb-journal-lines" role="table" aria-label="Quote lines">
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
              <span>Total {formatMinor(subtotalPreviewMinor.toString(), currency)}</span>
              <Badge tone="info">Tax is calculated once converted to an invoice</Badge>
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
              {quote?.status === 'DRAFT' && canManage ? (
                <Button
                  type="button"
                  onClick={() => void transition('submit', 'Submitted for approval.')}
                  loading={busy === 'submit'}
                >
                  Submit for approval
                </Button>
              ) : null}
              {quote?.status === 'PENDING_APPROVAL' && canApprove ? (
                <Button
                  type="button"
                  onClick={() => void transition('approve', 'Quote approved.')}
                  loading={busy === 'approve'}
                >
                  <CheckCircle2 aria-hidden="true" /> Approve
                </Button>
              ) : null}
              {quote?.status === 'APPROVED' && canManage ? (
                <Button
                  type="button"
                  onClick={() => void transition('send', 'Quote sent.')}
                  loading={busy === 'send'}
                >
                  Send to customer
                </Button>
              ) : null}
              {quote?.status === 'SENT' && canManage ? (
                <>
                  <Button
                    type="button"
                    onClick={() => void transition('accept', 'Quote accepted.')}
                    loading={busy === 'accept'}
                  >
                    <CheckCircle2 aria-hidden="true" /> Accept
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void transition('decline', 'Quote declined.')}
                    loading={busy === 'decline'}
                  >
                    <XCircle aria-hidden="true" /> Decline
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void transition('expire', 'Quote marked expired.')}
                    loading={busy === 'expire'}
                  >
                    Mark expired
                  </Button>
                </>
              ) : null}
              {quote?.status === 'ACCEPTED' && canConvert ? (
                <Button
                  type="button"
                  onClick={() => void transition('convert', 'Quote converted.')}
                  loading={busy === 'convert'}
                >
                  <CheckCircle2 aria-hidden="true" /> Convert to invoice
                </Button>
              ) : null}
            </div>
          </div>
          {!contactId && editable ? (
            <FieldMessage error>Choose a customer before saving this quote.</FieldMessage>
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
