'use client';

import type { Contact, Item, SalesOrder, SalesOrderStatus, TaxCode } from '@retailbooks/contracts';
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
import { TransactionCollaboration } from './transaction-collaboration';

type SalesOrderListResponse = { data: SalesOrder[] };
type SalesOrderResponse = { data: SalesOrder };
type ContactListResponse = { data: Contact[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };

const statusOptions: readonly SalesOrderStatus[] = [
  'DRAFT',
  'APPROVED',
  'CONFIRMED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CANCELLED',
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

export function SalesOrdersPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'sales.orders.view');
  const canManage = hasPermission(organization, 'sales.orders.manage');

  const [orders, setOrders] = useState<SalesOrder[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | SalesOrderStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<SalesOrderListResponse>(
        `/organizations/${organizationId}/sales-orders${suffix}`,
      );
      setOrders(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sales orders could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders ?? [];
    return (orders ?? []).filter((order) =>
      `${order.orderNumber ?? ''} ${order.contactName}`.toLowerCase().includes(needle),
    );
  }, [orders, query]);

  const columns: readonly DataTableColumn<SalesOrder>[] = [
    {
      key: 'order',
      header: 'Order',
      cell: (order) => (
        <div>
          <strong>{order.orderNumber ?? 'Draft'}</strong>
          <span className="rb-table-secondary">{order.contactName}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (order) => <StatusBadge status={order.status} /> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (order) => formatMinor(order.totalMinor, order.currency),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (order) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/sales-orders/${order.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or sales manager to grant sales order access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Sales orders"
        description="Confirm, fulfill, and convert customer orders."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/sales-orders/new">
                <FilePlus2 aria-hidden="true" /> New order
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
            <Label htmlFor="order-search">
              <Search aria-hidden="true" /> Search orders
            </Label>
            <Input
              id="order-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by order number or customer..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="order-status">Status</Label>
            <Select
              id="order-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All orders</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{orders?.length ?? 0} orders</Badge>
        </Card>

        {!orders && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No sales orders yet"
            description="Create your first order for a customer."
          />
        ) : (
          <DataTable caption="Sales orders" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const ORDER_FLASH_NOTICE_KEY = 'rb-sales-order-notice';

export function SalesOrderEditorPage({ orderId }: { orderId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'sales.orders.manage');
  const canApprove = hasPermission(organization, 'sales.orders.approve');
  const canConvert = hasPermission(organization, 'sales.orders.convert');

  const [customers, setCustomers] = useState<Contact[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [contactId, setContactId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [customerResponse, itemResponse, taxCodeResponse, orderResponse] = await Promise.all([
        apiRequest<ContactListResponse>(`/organizations/${organizationId}/customers?status=ACTIVE`),
        apiRequest<ItemListResponse>(
          `/organizations/${organizationId}/catalog/items?status=ACTIVE`,
        ),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        orderId
          ? apiRequest<SalesOrderResponse>(
              `/organizations/${organizationId}/sales-orders/${orderId}`,
            )
          : Promise.resolve(null),
      ]);
      setCustomers(customerResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      if (orderResponse) {
        setOrder(orderResponse.data);
        setContactId(orderResponse.data.contactId);
        setLines(
          orderResponse.data.lines.length > 0
            ? orderResponse.data.lines.map((line) => ({
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
      setError(caught instanceof Error ? caught.message : 'The order could not be loaded.');
    }
  }, [orderId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(ORDER_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(ORDER_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [orderId]);

  const contact = customers.find((candidate) => candidate.id === contactId) ?? null;
  const currency = contact?.currency ?? order?.currency ?? organization?.baseCurrency ?? 'KES';

  const subtotalPreviewMinor = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + previewLineTotalMinor(line.quantity, line.unitPrice, line.discount),
        0n,
      ),
    [lines],
  );

  const editable = (order ? order.status === 'DRAFT' : true) && canManage;
  const convertible =
    order &&
    !order.convertedInvoiceId &&
    (order.status === 'CONFIRMED' ||
      order.status === 'PARTIALLY_FULFILLED' ||
      order.status === 'FULFILLED');
  const cancellable =
    order &&
    (order.status === 'DRAFT' || order.status === 'APPROVED' || order.status === 'CONFIRMED');

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
      const response = await apiRequest<SalesOrderResponse>(
        orderId
          ? `/organizations/${organizationId}/sales-orders/${orderId}`
          : `/organizations/${organizationId}/sales-orders`,
        { method: orderId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setOrder(response.data);
      if (!orderId) {
        window.sessionStorage.setItem(ORDER_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/sales-orders/${response.data.id}`);
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
    if (!organizationId || !order?.id) return;
    setBusy(action);
    setError(null);
    try {
      const response = await apiRequest<SalesOrderResponse>(
        `/organizations/${organizationId}/sales-orders/${order.id}/${action}`,
        { method: 'POST' },
      );
      setOrder(response.data);
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
        title={order?.orderNumber ?? (orderId ? 'Sales order' : 'New sales order')}
        description="Build an order, approve and confirm it, then convert it to an invoice."
        actions={
          <Button asChild variant="outline">
            <Link href="/sales-orders">Back to sales orders</Link>
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
        {orderId && !order && !error ? <Skeleton /> : null}

        <Card className="rb-journal-editor">
          <div className="rb-journal-editor__meta">
            <div className="rb-field">
              <Label htmlFor="order-customer">Customer</Label>
              <Select
                id="order-customer"
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
              <Label htmlFor="order-currency">Currency</Label>
              <Input id="order-currency" value={currency} disabled />
            </div>
            {order ? <StatusBadge status={order.status} /> : null}
          </div>

          <div className="rb-journal-lines" role="table" aria-label="Order lines">
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
              {order?.status === 'DRAFT' && canApprove ? (
                <Button
                  type="button"
                  onClick={() => void transition('approve', 'Order approved.')}
                  loading={busy === 'approve'}
                >
                  <CheckCircle2 aria-hidden="true" /> Approve
                </Button>
              ) : null}
              {order?.status === 'APPROVED' && canManage ? (
                <Button
                  type="button"
                  onClick={() => void transition('confirm', 'Order confirmed.')}
                  loading={busy === 'confirm'}
                >
                  Confirm
                </Button>
              ) : null}
              {(order?.status === 'CONFIRMED' || order?.status === 'PARTIALLY_FULFILLED') &&
              canManage ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void transition('partially-fulfill', 'Order marked partially fulfilled.')
                    }
                    loading={busy === 'partially-fulfill'}
                  >
                    Mark partially fulfilled
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void transition('fulfill', 'Order fulfilled.')}
                    loading={busy === 'fulfill'}
                  >
                    <CheckCircle2 aria-hidden="true" /> Mark fulfilled
                  </Button>
                </>
              ) : null}
              {cancellable && canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void transition('cancel', 'Order cancelled.')}
                  loading={busy === 'cancel'}
                >
                  <XCircle aria-hidden="true" /> Cancel
                </Button>
              ) : null}
              {convertible && canConvert ? (
                <Button
                  type="button"
                  onClick={() => void transition('convert', 'Order converted.')}
                  loading={busy === 'convert'}
                >
                  <CheckCircle2 aria-hidden="true" /> Convert to invoice
                </Button>
              ) : null}
            </div>
          </div>
          {!contactId && editable ? (
            <FieldMessage error>Choose a customer before saving this order.</FieldMessage>
          ) : null}
        </Card>
        {organizationId && orderId ? (
          <TransactionCollaboration
            organizationId={organizationId}
            targetType="SALES_ORDER"
            targetId={orderId}
            canComment={hasPermission(organization, 'collaboration.comments.create')}
            canUpload={
              hasPermission(organization, 'collaboration.attachments.upload') &&
              hasPermission(organization, 'sales.orders.manage')
            }
            canShareWithCustomer={hasPermission(
              organization,
              'collaboration.customer_visibility.manage',
            )}
            customerEligible
          />
        ) : null}
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
