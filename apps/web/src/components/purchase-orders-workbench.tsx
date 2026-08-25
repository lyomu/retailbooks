'use client';

import type {
  Item,
  PurchaseOrder,
  PurchaseOrderStatus,
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
import { CheckCircle2, FilePlus2, Save, Search, Send, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type PurchaseOrderListResponse = { data: PurchaseOrder[] };
type PurchaseOrderResponse = { data: PurchaseOrder };
type VendorListResponse = { data: Vendor[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };

const statusOptions: readonly PurchaseOrderStatus[] = [
  'DRAFT',
  'APPROVED',
  'ISSUED',
  'CLOSED',
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

export function PurchaseOrdersPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'purchases.orders.view');
  const canManage = hasPermission(organization, 'purchases.orders.manage');

  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | PurchaseOrderStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<PurchaseOrderListResponse>(
        `/organizations/${organizationId}/purchase-orders${suffix}`,
      );
      setOrders(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Purchase orders could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders ?? [];
    return (orders ?? []).filter((order) =>
      `${order.orderNumber ?? ''} ${order.vendorName}`.toLowerCase().includes(needle),
    );
  }, [orders, query]);

  const columns: readonly DataTableColumn<PurchaseOrder>[] = [
    {
      key: 'order',
      header: 'Order',
      cell: (order) => (
        <div>
          <strong>{order.orderNumber ?? 'Draft'}</strong>
          <span className="rb-table-secondary">{order.vendorName}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (order) => <StatusBadge status={order.status} /> },
    {
      key: 'receipt',
      header: 'Receipt',
      cell: (order) => <StatusBadge status={order.receiptStatus} />,
    },
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
          <Link href={`/purchase-orders/${order.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or purchasing manager to grant purchase order access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Approve, issue, and receive orders placed with vendors."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/purchase-orders/new">
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
            <Label htmlFor="po-search">
              <Search aria-hidden="true" /> Search orders
            </Label>
            <Input
              id="po-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by order number or vendor..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="po-status">Status</Label>
            <Select
              id="po-status"
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
            title="No purchase orders yet"
            description="Create your first order for a vendor."
          />
        ) : (
          <DataTable caption="Purchase orders" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const ORDER_FLASH_NOTICE_KEY = 'rb-purchase-order-notice';

export function PurchaseOrderEditorPage({ orderId }: { orderId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'purchases.orders.manage');
  const canApprove = hasPermission(organization, 'purchases.orders.approve');
  const canIssue = hasPermission(organization, 'purchases.orders.issue');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [vendorResponse, itemResponse, taxCodeResponse, orderResponse] = await Promise.all([
        apiRequest<VendorListResponse>(`/organizations/${organizationId}/vendors?status=ACTIVE`),
        apiRequest<ItemListResponse>(
          `/organizations/${organizationId}/catalog/items?status=ACTIVE`,
        ),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        orderId
          ? apiRequest<PurchaseOrderResponse>(
              `/organizations/${organizationId}/purchase-orders/${orderId}`,
            )
          : Promise.resolve(null),
      ]);
      setVendors(vendorResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      if (orderResponse) {
        setOrder(orderResponse.data);
        setVendorId(orderResponse.data.vendorId);
        setExpectedDeliveryDate(orderResponse.data.expectedDeliveryDate ?? '');
        setDeliveryNote(orderResponse.data.deliveryNote ?? '');
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

  const vendor = vendors.find((candidate) => candidate.id === vendorId) ?? null;
  const currency = vendor?.currency ?? order?.currency ?? organization?.baseCurrency ?? 'KES';

  const subtotalPreviewMinor = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + previewLineTotalMinor(line.quantity, line.unitPrice, line.discount),
        0n,
      ),
    [lines],
  );

  const editable = (order ? order.status === 'DRAFT' : true) && canManage;
  const cancellable = order && ['DRAFT', 'APPROVED', 'ISSUED'].includes(order.status);
  const closable = order && order.status === 'ISSUED';

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

  async function saveDraft() {
    if (!organizationId || !vendorId) return null;
    setBusy('save');
    setError(null);
    try {
      const payload = {
        vendorId,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        deliveryNote: deliveryNote || undefined,
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
      const response = await apiRequest<PurchaseOrderResponse>(
        orderId
          ? `/organizations/${organizationId}/purchase-orders/${orderId}`
          : `/organizations/${organizationId}/purchase-orders`,
        { method: orderId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setOrder(response.data);
      if (!orderId) {
        window.sessionStorage.setItem(ORDER_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/purchase-orders/${response.data.id}`);
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

  async function transition(action: string, noticeText: string, body?: Record<string, unknown>) {
    if (!organizationId || !order?.id) return;
    setBusy(action);
    setError(null);
    try {
      const response = await apiRequest<PurchaseOrderResponse>(
        `/organizations/${organizationId}/purchase-orders/${order.id}/${action}`,
        { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) },
      );
      setOrder(response.data);
      setNotice(noticeText);
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
        title={order?.orderNumber ?? (orderId ? 'Purchase order' : 'New purchase order')}
        description="Build an order, approve and issue it, then record receipt against it."
        actions={
          <Button asChild variant="outline">
            <Link href="/purchase-orders">Back to purchase orders</Link>
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
              <Label htmlFor="po-vendor">Vendor</Label>
              <Select
                id="po-vendor"
                value={vendorId}
                disabled={!editable}
                onChange={(event) => setVendorId(event.target.value)}
              >
                <option value="">Choose vendor</option>
                {vendors.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="rb-field">
              <Label htmlFor="po-currency">Currency</Label>
              <Input id="po-currency" value={currency} disabled />
            </div>
            <div className="rb-field">
              <Label htmlFor="po-delivery-date">Expected delivery</Label>
              <Input
                id="po-delivery-date"
                type="date"
                value={expectedDeliveryDate}
                disabled={!editable}
                onChange={(event) => setExpectedDeliveryDate(event.target.value)}
              />
            </div>
            {order ? <StatusBadge status={order.status} /> : null}
            {order ? <StatusBadge status={order.receiptStatus} /> : null}
          </div>
          <div className="rb-field">
            <Label htmlFor="po-delivery-note">Delivery info</Label>
            <Input
              id="po-delivery-note"
              value={deliveryNote}
              disabled={!editable}
              maxLength={500}
              onChange={(event) => setDeliveryNote(event.target.value)}
            />
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
              {order && order.billedMinor !== '0' ? (
                <Badge tone="info">Billed so far: {formatMinor(order.billedMinor, currency)}</Badge>
              ) : null}
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
                    disabled={!vendorId}
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
              {order?.status === 'APPROVED' && canIssue ? (
                <Button
                  type="button"
                  onClick={() => void transition('issue', 'Order issued to vendor.')}
                  loading={busy === 'issue'}
                >
                  <Send aria-hidden="true" /> Issue to vendor
                </Button>
              ) : null}
              {order?.status === 'ISSUED' && canManage ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void transition('receipt', 'Receipt recorded.', {
                        receiptStatus: 'PARTIALLY_RECEIVED',
                      })
                    }
                    loading={busy === 'receipt'}
                    disabled={order.receiptStatus === 'RECEIVED'}
                  >
                    Mark partially received
                  </Button>
                  <Button
                    type="button"
                    onClick={() =>
                      void transition('receipt', 'Order fully received.', {
                        receiptStatus: 'RECEIVED',
                      })
                    }
                    loading={busy === 'receipt'}
                    disabled={order.receiptStatus === 'RECEIVED'}
                  >
                    <CheckCircle2 aria-hidden="true" /> Mark received
                  </Button>
                </>
              ) : null}
              {closable && canManage ? (
                <Button
                  type="button"
                  onClick={() => void transition('close', 'Order closed.')}
                  loading={busy === 'close'}
                >
                  Close order
                </Button>
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
            </div>
          </div>
          {!vendorId && editable ? (
            <FieldMessage error>Choose a vendor before saving this order.</FieldMessage>
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
