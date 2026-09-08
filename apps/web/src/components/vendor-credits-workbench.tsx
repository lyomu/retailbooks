'use client';

import type {
  Item,
  OpenBillForAllocation,
  TaxCode,
  Vendor,
  VendorCredit,
  VendorCreditStatus,
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
import { CheckCircle2, FilePlus2, Save, Search, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { TransactionCollaboration } from './transaction-collaboration';

type VendorCreditListResponse = { data: VendorCredit[] };
type VendorCreditResponse = { data: VendorCredit };
type VendorListResponse = { data: Vendor[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };
type OpenBillListResponse = { data: OpenBillForAllocation[] };

const statusOptions: readonly VendorCreditStatus[] = ['DRAFT', 'ISSUED', 'APPLIED', 'VOID'];

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

export function VendorCreditsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'purchases.vendor_credits.view');
  const canManage = hasPermission(organization, 'purchases.vendor_credits.manage');

  const [vendorCredits, setVendorCredits] = useState<VendorCredit[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | VendorCreditStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<VendorCreditListResponse>(
        `/organizations/${organizationId}/vendor-credits${suffix}`,
      );
      setVendorCredits(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Vendor credits could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return vendorCredits ?? [];
    return (vendorCredits ?? []).filter((vendorCredit) =>
      `${vendorCredit.vendorCreditNumber ?? ''} ${vendorCredit.vendorName}`
        .toLowerCase()
        .includes(needle),
    );
  }, [vendorCredits, query]);

  const columns: readonly DataTableColumn<VendorCredit>[] = [
    {
      key: 'vendorCredit',
      header: 'Vendor credit',
      cell: (vendorCredit) => (
        <div>
          <strong>{vendorCredit.vendorCreditNumber ?? 'Draft'}</strong>
          <span className="rb-table-secondary">{vendorCredit.vendorName}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (vendorCredit) => <StatusBadge status={vendorCredit.status} />,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (vendorCredit) => formatMinor(vendorCredit.totalMinor, vendorCredit.currency),
    },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'right',
      cell: (vendorCredit) => formatMinor(vendorCredit.remainingMinor, vendorCredit.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (vendorCredit) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/vendor-credits/${vendorCredit.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant vendor credit access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Vendor credits"
        description="Issue vendor credits and apply their balance against open bills."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/vendor-credits/new">
                <FilePlus2 aria-hidden="true" /> New vendor credit
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
            <Label htmlFor="vendor-credit-search">
              <Search aria-hidden="true" /> Search vendor credits
            </Label>
            <Input
              id="vendor-credit-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by number or vendor..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="vendor-credit-status">Status</Label>
            <Select
              id="vendor-credit-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All vendor credits</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{vendorCredits?.length ?? 0} vendor credits</Badge>
        </Card>

        {!vendorCredits && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No vendor credits yet"
            description="Create your first vendor credit to credit a vendor."
          />
        ) : (
          <DataTable caption="Vendor credits" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const VENDOR_CREDIT_FLASH_NOTICE_KEY = 'rb-vendor-credit-notice';

export function VendorCreditEditorPage({ vendorCreditId }: { vendorCreditId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'purchases.vendor_credits.manage');
  const canIssue = hasPermission(organization, 'purchases.vendor_credits.issue');
  const canVoid = hasPermission(organization, 'purchases.vendor_credits.void');
  const canAllocate = hasPermission(organization, 'purchases.vendor_credits.allocate');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [openBills, setOpenBills] = useState<OpenBillForAllocation[]>([]);
  const [vendorCredit, setVendorCredit] = useState<VendorCredit | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [
        vendorResponse,
        itemResponse,
        taxCodeResponse,
        vendorCreditResponse,
        openBillsResponse,
      ] = await Promise.all([
        apiRequest<VendorListResponse>(`/organizations/${organizationId}/vendors?status=ACTIVE`),
        apiRequest<ItemListResponse>(
          `/organizations/${organizationId}/catalog/items?status=ACTIVE`,
        ),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        vendorCreditId
          ? apiRequest<VendorCreditResponse>(
              `/organizations/${organizationId}/vendor-credits/${vendorCreditId}`,
            )
          : Promise.resolve(null),
        vendorCreditId
          ? apiRequest<OpenBillListResponse>(
              `/organizations/${organizationId}/vendor-credits/${vendorCreditId}/open-bills`,
            )
          : Promise.resolve(null),
      ]);
      setVendors(vendorResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      if (vendorCreditResponse) {
        setVendorCredit(vendorCreditResponse.data);
        setVendorId(vendorCreditResponse.data.vendorId);
        setReason(vendorCreditResponse.data.reason ?? '');
        setLines(
          vendorCreditResponse.data.lines.length > 0
            ? vendorCreditResponse.data.lines.map((line) => ({
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
      setOpenBills(openBillsResponse?.data ?? []);
      setAllocationAmounts({});
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The vendor credit could not be loaded.');
    }
  }, [vendorCreditId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(VENDOR_CREDIT_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(VENDOR_CREDIT_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [vendorCreditId]);

  const vendor = vendors.find((candidate) => candidate.id === vendorId) ?? null;
  const currency =
    vendor?.currency ?? vendorCredit?.currency ?? organization?.baseCurrency ?? 'KES';

  const subtotalPreviewMinor = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + previewLineTotalMinor(line.quantity, line.unitPrice, line.discount),
        0n,
      ),
    [lines],
  );

  const posted = vendorCredit ? vendorCredit.status !== 'DRAFT' : false;
  const editable = !posted && canManage;

  const totalToApplyMinor = useMemo(
    () =>
      Object.values(allocationAmounts).reduce(
        (sum, value) => sum + (value ? BigInt(decimalToMinor(value)) : 0n),
        0n,
      ),
    [allocationAmounts],
  );
  const remainingMinor = vendorCredit ? BigInt(vendorCredit.remainingMinor) : 0n;
  const exceedsRemaining = totalToApplyMinor > remainingMinor;
  const canSubmitAllocation = canAllocate && totalToApplyMinor > 0n && !exceedsRemaining;

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
        reason: reason || undefined,
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
          };
        }),
      };
      const response = await apiRequest<VendorCreditResponse>(
        vendorCreditId
          ? `/organizations/${organizationId}/vendor-credits/${vendorCreditId}`
          : `/organizations/${organizationId}/vendor-credits`,
        { method: vendorCreditId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setVendorCredit(response.data);
      if (!vendorCreditId) {
        window.sessionStorage.setItem(VENDOR_CREDIT_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/vendor-credits/${response.data.id}`);
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

  async function issueVendorCredit() {
    if (!organizationId || !vendorCredit?.id) return;
    setBusy('issue');
    setError(null);
    try {
      const response = await apiRequest<VendorCreditResponse>(
        `/organizations/${organizationId}/vendor-credits/${vendorCredit.id}/issue`,
        { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setVendorCredit(response.data);
      setNotice(`Issued as ${response.data.vendorCreditNumber}.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The vendor credit could not be issued.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function voidVendorCredit() {
    if (!organizationId || !vendorCredit?.id) return;
    setBusy('void');
    setError(null);
    try {
      const response = await apiRequest<VendorCreditResponse>(
        `/organizations/${organizationId}/vendor-credits/${vendorCredit.id}/void`,
        { method: 'POST' },
      );
      setVendorCredit(response.data);
      setNotice('Vendor credit voided.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The vendor credit could not be voided.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function allocate() {
    if (!organizationId || !vendorCredit) return;
    const allocations = Object.entries(allocationAmounts)
      .filter(([, value]) => value.trim() !== '')
      .map(([billId, value]) => ({ billId, amountMinor: decimalToMinor(value) }));
    if (allocations.length === 0) return;
    setBusy('allocate');
    setError(null);
    try {
      const response = await apiRequest<VendorCreditResponse>(
        `/organizations/${organizationId}/vendor-credits/${vendorCredit.id}/allocate`,
        {
          method: 'POST',
          body: JSON.stringify({ allocations }),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      );
      setVendorCredit(response.data);
      setNotice('Vendor credit allocated.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The allocation could not be applied.',
      );
    } finally {
      setBusy(null);
    }
  }

  const canVoidNow =
    vendorCredit &&
    vendorCredit.status === 'ISSUED' &&
    vendorCredit.remainingMinor === vendorCredit.totalMinor &&
    canVoid;
  const hasRemainingBalance = vendorCredit && vendorCredit.status === 'ISSUED';

  return (
    <>
      <PageHeader
        title={
          vendorCredit?.vendorCreditNumber ??
          (vendorCreditId ? 'Vendor credit' : 'New vendor credit')
        }
        description={
          posted
            ? 'Issued vendor credits are immutable. Void to reverse one with nothing applied.'
            : 'Build a draft, then issue to post it to the ledger.'
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/vendor-credits">Back to vendor credits</Link>
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
        {vendorCreditId && !vendorCredit && !error ? <Skeleton /> : null}

        <Card className="rb-journal-editor">
          <div className="rb-journal-editor__meta">
            <div className="rb-field">
              <Label htmlFor="vendor-credit-vendor">Vendor</Label>
              <Select
                id="vendor-credit-vendor"
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
              <Label htmlFor="vendor-credit-reason">Reason</Label>
              <Input
                id="vendor-credit-reason"
                value={reason}
                disabled={!editable}
                maxLength={240}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="vendor-credit-currency">Currency</Label>
              <Input id="vendor-credit-currency" value={currency} disabled />
            </div>
            {vendorCredit ? <StatusBadge status={vendorCredit.status} /> : null}
          </div>

          <div className="rb-journal-lines" role="table" aria-label="Vendor credit lines">
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
              {vendorCredit && vendorCredit.status !== 'DRAFT' ? (
                <>
                  <span>Tax {formatMinor(vendorCredit.taxTotalMinor, currency)}</span>
                  <span>Total {formatMinor(vendorCredit.totalMinor, currency)}</span>
                  <span>Remaining {formatMinor(vendorCredit.remainingMinor, currency)}</span>
                </>
              ) : (
                <Badge tone="info">Tax is calculated when the vendor credit is issued</Badge>
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
              {vendorCredit?.status === 'DRAFT' && canIssue ? (
                <Button
                  type="button"
                  onClick={() => void issueVendorCredit()}
                  loading={busy === 'issue'}
                >
                  <CheckCircle2 aria-hidden="true" /> Issue
                </Button>
              ) : null}
              {canVoidNow ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void voidVendorCredit()}
                  loading={busy === 'void'}
                >
                  <XCircle aria-hidden="true" /> Void
                </Button>
              ) : null}
            </div>
          </div>
          {!vendorId && editable ? (
            <FieldMessage error>Choose a vendor before saving this vendor credit.</FieldMessage>
          ) : null}
        </Card>

        {hasRemainingBalance ? (
          <Card className="rb-journal-editor">
            <PageHeader
              title="Allocate against bills"
              description="Apply this vendor credit's remaining balance against the vendor's open bills."
            />
            {openBills.length === 0 ? (
              <EmptyState
                title="No open bills"
                description="This vendor has no issued bills with an outstanding balance."
              />
            ) : (
              <>
                <div className="rb-journal-lines" role="table" aria-label="Open bills">
                  <div className="rb-journal-lines__head" role="row">
                    <span>Bill</span>
                    <span>Total</span>
                    <span>Balance</span>
                    <span>Amount to apply</span>
                  </div>
                  {openBills.map((bill) => (
                    <div className="rb-journal-lines__row" role="row" key={bill.id}>
                      <span>{bill.billNumber ?? 'Bill'}</span>
                      <span className="rb-table-secondary rb-num">
                        {formatMinor(bill.totalMinor, bill.currency)}
                      </span>
                      <span className="rb-table-secondary rb-num">
                        {formatMinor(bill.balanceMinor, bill.currency)}
                      </span>
                      <Input
                        aria-label={`Amount to apply to bill ${bill.billNumber ?? bill.id}`}
                        inputMode="decimal"
                        value={allocationAmounts[bill.id] ?? ''}
                        disabled={!canAllocate}
                        onChange={(event) =>
                          setAllocationAmounts((current) => ({
                            ...current,
                            [bill.id]: event.target.value,
                          }))
                        }
                        placeholder="0.00"
                      />
                    </div>
                  ))}
                </div>
                <div className="rb-journal-editor__footer">
                  <div>
                    <span>To apply {formatMinor(totalToApplyMinor.toString(), currency)}</span>
                    <span>Remaining {formatMinor(vendorCredit.remainingMinor, currency)}</span>
                    {exceedsRemaining ? (
                      <Badge tone="danger">Exceeds the remaining balance</Badge>
                    ) : null}
                  </div>
                  {canAllocate ? (
                    <div className="rb-dialog-footer">
                      <Button
                        type="button"
                        onClick={() => void allocate()}
                        loading={busy === 'allocate'}
                        disabled={!canSubmitAllocation}
                      >
                        <CheckCircle2 aria-hidden="true" /> Allocate
                      </Button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </Card>
        ) : null}
        {organizationId && vendorCreditId ? (
          <TransactionCollaboration
            organizationId={organizationId}
            targetType="VENDOR_CREDIT"
            targetId={vendorCreditId}
            canComment={hasPermission(organization, 'collaboration.comments.create')}
            canUpload={
              hasPermission(organization, 'collaboration.attachments.upload') &&
              hasPermission(organization, 'purchases.vendor_credits.manage')
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
