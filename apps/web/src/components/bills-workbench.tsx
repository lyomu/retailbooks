'use client';

import type {
  AttachmentListResponse,
  Bill,
  BillStatus,
  Item,
  LedgerAccount,
  PurchaseOrder,
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

type BillListResponse = { data: Bill[] };
type BillResponse = { data: Bill };
type VendorListResponse = { data: Vendor[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };
type AccountListResponse = { data: LedgerAccount[] };
type PurchaseOrderListResponse = { data: PurchaseOrder[] };
// The listing no longer carries a signed URL: the link is issued by a separate, re-authorized
// download endpoint, so a stale list can never hand out a live link to bytes.
type AttachmentRow = Omit<AttachmentListResponse['data'][number], 'downloadUrl'>;

const statusOptions: readonly BillStatus[] = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'];

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

export function BillsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'purchases.bills.view');
  const canManage = hasPermission(organization, 'purchases.bills.manage');

  const [bills, setBills] = useState<Bill[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | BillStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<BillListResponse>(
        `/organizations/${organizationId}/bills${suffix}`,
      );
      setBills(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Bills could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bills ?? [];
    return (bills ?? []).filter((bill) =>
      `${bill.billNumber ?? ''} ${bill.vendorReference ?? ''} ${bill.vendorName}`
        .toLowerCase()
        .includes(needle),
    );
  }, [bills, query]);

  const columns: readonly DataTableColumn<Bill>[] = [
    {
      key: 'bill',
      header: 'Bill',
      cell: (bill) => (
        <div>
          <strong>{bill.billNumber ?? 'Draft'}</strong>
          <span className="rb-table-secondary">{bill.vendorName}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (bill) => <StatusBadge status={bill.status} /> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (bill) => formatMinor(bill.totalMinor, bill.currency),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (bill) => formatMinor(bill.balanceMinor, bill.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (bill) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/bills/${bill.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant bill access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Bills"
        description="Record, issue, and void vendor bills."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/bills/new">
                <FilePlus2 aria-hidden="true" /> New bill
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
            <Label htmlFor="bill-search">
              <Search aria-hidden="true" /> Search bills
            </Label>
            <Input
              id="bill-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by bill number, vendor reference, or vendor..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="bill-status">Status</Label>
            <Select
              id="bill-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All bills</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{bills?.length ?? 0} bills</Badge>
        </Card>

        {!bills && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState title="No bills yet" description="Record your first vendor bill." />
        ) : (
          <DataTable caption="Bills" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const BILL_FLASH_NOTICE_KEY = 'rb-bill-notice';

export function BillEditorPage({ billId }: { billId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'purchases.bills.manage');
  const canIssue = hasPermission(organization, 'purchases.bills.issue');
  const canVoid = hasPermission(organization, 'purchases.bills.void');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [bill, setBill] = useState<Bill | null>(null);
  const [attachments, setAttachments] = useState<AttachmentRow[] | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [vendorReference, setVendorReference] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAttachments = useCallback(async () => {
    if (!organizationId || !billId) return;
    try {
      const response = await apiRequest<AttachmentListResponse>(
        `/organizations/${organizationId}/bills/${billId}/attachments`,
      );
      setAttachments(response.data);
    } catch {
      // Non-fatal: attachment list failing shouldn't block viewing the bill itself.
    }
  }, [organizationId, billId]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [
        vendorResponse,
        itemResponse,
        taxCodeResponse,
        accountResponse,
        poResponse,
        billResponse,
      ] = await Promise.all([
        apiRequest<VendorListResponse>(`/organizations/${organizationId}/vendors?status=ACTIVE`),
        apiRequest<ItemListResponse>(
          `/organizations/${organizationId}/catalog/items?status=ACTIVE`,
        ),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
        apiRequest<PurchaseOrderListResponse>(`/organizations/${organizationId}/purchase-orders`),
        billId
          ? apiRequest<BillResponse>(`/organizations/${organizationId}/bills/${billId}`)
          : Promise.resolve(null),
      ]);
      setVendors(vendorResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setPurchaseOrders(poResponse.data.filter((po) => po.status === 'ISSUED'));
      if (billResponse) {
        setBill(billResponse.data);
        setVendorId(billResponse.data.vendorId);
        setPurchaseOrderId(billResponse.data.purchaseOrderId ?? '');
        setVendorReference(billResponse.data.vendorReference ?? '');
        setDueDate(billResponse.data.dueDate ?? '');
        setLines(
          billResponse.data.lines.length > 0
            ? billResponse.data.lines.map((line) => ({
                key: line.id,
                itemId: line.itemId ?? '',
                description: line.descriptionSnapshot,
                quantity: line.quantity,
                unitPrice: minorToDecimal(line.unitPriceMinor),
                discount: line.discountMinor === '0' ? '' : minorToDecimal(line.discountMinor),
                taxCodeId: line.taxCodeId ?? '',
                accountId: line.accountId ?? '',
              }))
            : [blankLine()],
        );
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The bill could not be loaded.');
    }
  }, [billId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(BILL_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(BILL_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [billId]);

  const vendor = vendors.find((candidate) => candidate.id === vendorId) ?? null;
  const currency = vendor?.currency ?? bill?.currency ?? organization?.baseCurrency ?? 'KES';

  const subtotalPreviewMinor = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + previewLineTotalMinor(line.quantity, line.unitPrice, line.discount),
        0n,
      ),
    [lines],
  );

  const posted = bill ? bill.status !== 'DRAFT' : false;
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
        purchaseOrderId: purchaseOrderId || undefined,
        vendorReference: vendorReference || undefined,
        dueDate: dueDate || undefined,
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
      const response = await apiRequest<BillResponse>(
        billId
          ? `/organizations/${organizationId}/bills/${billId}`
          : `/organizations/${organizationId}/bills`,
        { method: billId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setBill(response.data);
      if (!billId) {
        window.sessionStorage.setItem(BILL_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/bills/${response.data.id}`);
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

  async function issueBill() {
    if (!organizationId || !bill?.id) return;
    setBusy('issue');
    setError(null);
    try {
      const response = await apiRequest<BillResponse>(
        `/organizations/${organizationId}/bills/${bill.id}/issue`,
        { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setBill(response.data);
      setNotice(`Issued as ${response.data.billNumber}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The bill could not be issued.');
    } finally {
      setBusy(null);
    }
  }

  async function voidBill() {
    if (!organizationId || !bill?.id) return;
    setBusy('void');
    setError(null);
    try {
      const response = await apiRequest<BillResponse>(
        `/organizations/${organizationId}/bills/${bill.id}/void`,
        { method: 'POST' },
      );
      setBill(response.data);
      setNotice('Bill voided.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The bill could not be voided.');
    } finally {
      setBusy(null);
    }
  }

  /** Re-authorizes and then opens the short-lived link, rather than trusting a listed URL. */
  async function openAttachment(attachmentId: string) {
    if (!organizationId || !bill?.id) return;
    try {
      const response = await apiRequest<{ data: { downloadUrl: string } }>(
        `/organizations/${organizationId}/bills/${bill.id}/attachments/${attachmentId}/download`,
      );
      window.open(response.data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The attachment could not be opened.');
    }
  }

  async function uploadAttachment(file: File) {
    if (!organizationId || !bill?.id) return;
    setBusy('attach');
    setError(null);
    try {
      await apiUpload(`/organizations/${organizationId}/bills/${bill.id}/attachments`, file);
      setNotice('Attachment uploaded.');
      await loadAttachments();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The attachment could not be uploaded.',
      );
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const canVoidNow =
    bill &&
    (bill.status === 'ISSUED' || bill.status === 'PARTIALLY_PAID') &&
    bill.paidMinor === '0' &&
    canVoid;

  return (
    <>
      <PageHeader
        title={bill?.billNumber ?? (billId ? 'Bill' : 'New bill')}
        description={
          posted
            ? 'Issued bills are immutable. Void to reverse an unpaid bill.'
            : 'Build a draft, then issue to post it to the ledger.'
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/bills">Back to bills</Link>
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
        {billId && !bill && !error ? <Skeleton /> : null}

        <Card className="rb-journal-editor">
          <div className="rb-journal-editor__meta">
            <div className="rb-field">
              <Label htmlFor="bill-vendor">Vendor</Label>
              <Select
                id="bill-vendor"
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
              <Label htmlFor="bill-po">Purchase order</Label>
              <Select
                id="bill-po"
                value={purchaseOrderId}
                disabled={!editable}
                onChange={(event) => setPurchaseOrderId(event.target.value)}
              >
                <option value="">None</option>
                {purchaseOrders
                  .filter((po) => !vendorId || po.vendorId === vendorId)
                  .map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.orderNumber}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="rb-field">
              <Label htmlFor="bill-vendor-reference">Vendor's bill no.</Label>
              <Input
                id="bill-vendor-reference"
                value={vendorReference}
                disabled={!editable}
                maxLength={64}
                onChange={(event) => setVendorReference(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="bill-due-date">Due date</Label>
              <Input
                id="bill-due-date"
                type="date"
                value={dueDate}
                disabled={!editable}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="bill-currency">Currency</Label>
              <Input id="bill-currency" value={currency} disabled />
            </div>
            {bill ? <StatusBadge status={bill.status} /> : null}
          </div>

          <div className="rb-journal-lines" role="table" aria-label="Bill lines">
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
                  <Select
                    aria-label={`Account for line ${index + 1}`}
                    value={line.accountId}
                    disabled={!editable}
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
              {bill && bill.status !== 'DRAFT' ? (
                <>
                  <span>Tax {formatMinor(bill.taxTotalMinor, currency)}</span>
                  <span>Total {formatMinor(bill.totalMinor, currency)}</span>
                  <span>Balance {formatMinor(bill.balanceMinor, currency)}</span>
                </>
              ) : (
                <Badge tone="info">Tax is calculated when the bill is issued</Badge>
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
                    disabled={!vendorId}
                  >
                    <Save aria-hidden="true" /> Save draft
                  </Button>
                </>
              ) : null}
              {bill?.status === 'DRAFT' && canIssue ? (
                <Button type="button" onClick={() => void issueBill()} loading={busy === 'issue'}>
                  <CheckCircle2 aria-hidden="true" /> Issue
                </Button>
              ) : null}
              {canVoidNow ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void voidBill()}
                  loading={busy === 'void'}
                >
                  <XCircle aria-hidden="true" /> Void
                </Button>
              ) : null}
            </div>
          </div>
          {!vendorId && editable ? (
            <FieldMessage error>Choose a vendor before saving this bill.</FieldMessage>
          ) : null}
        </Card>

        {bill ? (
          <Card className="rb-ledger-toolbar">
            <div className="rb-field-grid">
              <strong>
                <Paperclip aria-hidden="true" /> Attachments
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
              <span className="rb-table-secondary">No attachments yet.</span>
            )}
          </Card>
        ) : null}
        {billId && organizationId ? (
          <TransactionCollaboration
            organizationId={organizationId}
            targetType="BILL"
            targetId={billId}
            canComment={hasPermission(organization, 'collaboration.comments.create')}
            canUpload={
              hasPermission(organization, 'collaboration.attachments.upload') &&
              hasPermission(organization, 'purchases.bills.manage')
            }
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
