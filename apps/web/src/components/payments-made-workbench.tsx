'use client';

import type {
  OpenBillForAllocation,
  PaymentMade,
  PaymentStatus,
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
import { CheckCircle2, PlusCircle, Save, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type PaymentListResponse = { data: PaymentMade[] };
type PaymentResponse = { data: PaymentMade };
type VendorListResponse = { data: Vendor[] };
type OpenBillListResponse = { data: OpenBillForAllocation[] };

const statusOptions: readonly PaymentStatus[] = [
  'UNAPPLIED',
  'PARTIALLY_ALLOCATED',
  'FULLY_ALLOCATED',
];

export function PaymentsMadePage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'purchases.payments_made.view');
  const canRecord = hasPermission(organization, 'purchases.payments_made.record');

  const [payments, setPayments] = useState<PaymentMade[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | PaymentStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<PaymentListResponse>(
        `/organizations/${organizationId}/payments-made${suffix}`,
      );
      setPayments(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Payments could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return payments ?? [];
    return (payments ?? []).filter((payment) =>
      `${payment.paymentNumber ?? ''} ${payment.vendorName}`.toLowerCase().includes(needle),
    );
  }, [payments, query]);

  const columns: readonly DataTableColumn<PaymentMade>[] = [
    {
      key: 'payment',
      header: 'Payment',
      cell: (payment) => (
        <div>
          <strong>{payment.paymentNumber ?? 'Payment'}</strong>
          <span className="rb-table-secondary">{payment.vendorName}</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (payment) => <StatusBadge status={payment.status} /> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (payment) => formatMinor(payment.amountMinor, payment.currency),
    },
    {
      key: 'unapplied',
      header: 'Unapplied',
      align: 'right',
      cell: (payment) => formatMinor(payment.unappliedMinor, payment.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (payment) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/payments-made/${payment.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant payment access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Payments made"
        description="Record vendor payments and apply them against open bills."
        actions={
          canRecord ? (
            <Button asChild>
              <Link href="/payments-made/new">
                <PlusCircle aria-hidden="true" /> Record payment
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
            <Label htmlFor="payment-made-search">
              <Search aria-hidden="true" /> Search payments
            </Label>
            <Input
              id="payment-made-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by payment number or vendor..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="payment-made-status">Status</Label>
            <Select
              id="payment-made-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All payments</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{payments?.length ?? 0} payments</Badge>
        </Card>

        {!payments && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Record your first vendor payment to start applying it against bills."
          />
        ) : (
          <DataTable caption="Payments made" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const PAYMENT_FLASH_NOTICE_KEY = 'rb-payment-made-notice';

export function PaymentMadeEditorPage({ paymentId }: { paymentId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canRecord = hasPermission(organization, 'purchases.payments_made.record');
  const canAllocate = hasPermission(organization, 'purchases.payments_made.allocate');

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payment, setPayment] = useState<PaymentMade | null>(null);
  const [openBills, setOpenBills] = useState<OpenBillForAllocation[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [vendorResponse, paymentResponse, openBillsResponse] = await Promise.all([
        apiRequest<VendorListResponse>(`/organizations/${organizationId}/vendors?status=ACTIVE`),
        paymentId
          ? apiRequest<PaymentResponse>(
              `/organizations/${organizationId}/payments-made/${paymentId}`,
            )
          : Promise.resolve(null),
        paymentId
          ? apiRequest<OpenBillListResponse>(
              `/organizations/${organizationId}/payments-made/${paymentId}/open-bills`,
            )
          : Promise.resolve(null),
      ]);
      setVendors(vendorResponse.data);
      if (paymentResponse) {
        setPayment(paymentResponse.data);
        setVendorId(paymentResponse.data.vendorId);
      }
      setOpenBills(openBillsResponse?.data ?? []);
      setAllocationAmounts({});
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The payment could not be loaded.');
    }
  }, [organizationId, paymentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(PAYMENT_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(PAYMENT_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [paymentId]);

  const vendor = vendors.find((candidate) => candidate.id === vendorId) ?? null;
  const currency = vendor?.currency ?? payment?.currency ?? organization?.baseCurrency ?? 'KES';

  const totalToApplyMinor = useMemo(
    () =>
      Object.values(allocationAmounts).reduce(
        (sum, value) => sum + (value ? BigInt(decimalToMinor(value)) : 0n),
        0n,
      ),
    [allocationAmounts],
  );
  const unappliedMinor = payment ? BigInt(payment.unappliedMinor) : 0n;
  const exceedsUnapplied = totalToApplyMinor > unappliedMinor;
  const canSubmitAllocation = canAllocate && totalToApplyMinor > 0n && !exceedsUnapplied;

  async function recordPayment() {
    if (!organizationId || !vendorId || !amount) return;
    setBusy('record');
    setError(null);
    try {
      const payload = { vendorId, paidDate, amountMinor: decimalToMinor(amount) };
      const response = await apiRequest<PaymentResponse>(
        `/organizations/${organizationId}/payments-made`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      );
      window.sessionStorage.setItem(PAYMENT_FLASH_NOTICE_KEY, 'Payment recorded.');
      router.replace(`/payments-made/${response.data.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The payment could not be recorded.');
    } finally {
      setBusy(null);
    }
  }

  async function allocate() {
    if (!organizationId || !payment) return;
    const allocations = Object.entries(allocationAmounts)
      .filter(([, value]) => value.trim() !== '')
      .map(([billId, value]) => ({ billId, amountMinor: decimalToMinor(value) }));
    if (allocations.length === 0) return;
    setBusy('allocate');
    setError(null);
    try {
      const response = await apiRequest<PaymentResponse>(
        `/organizations/${organizationId}/payments-made/${payment.id}/allocate`,
        {
          method: 'POST',
          body: JSON.stringify({ allocations }),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      );
      setPayment(response.data);
      setNotice('Payment allocated.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The allocation could not be applied.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (!paymentId) {
    return (
      <>
        <PageHeader
          title="New payment"
          description="Record a vendor payment. It posts to the ledger immediately."
          actions={
            <Button asChild variant="outline">
              <Link href="/payments-made">Back to payments</Link>
            </Button>
          }
        />
        <div className="rb-ledger-stack">
          {error ? (
            <div className="rb-auth-error" role="alert">
              {error}
            </div>
          ) : null}

          <Card className="rb-journal-editor">
            <div className="rb-journal-editor__meta">
              <div className="rb-field">
                <Label htmlFor="payment-made-vendor">Vendor</Label>
                <Select
                  id="payment-made-vendor"
                  value={vendorId}
                  disabled={!canRecord}
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
                <Label htmlFor="payment-made-date">Paid date</Label>
                <Input
                  id="payment-made-date"
                  type="date"
                  value={paidDate}
                  disabled={!canRecord}
                  onChange={(event) => setPaidDate(event.target.value)}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="payment-made-amount">Amount</Label>
                <Input
                  id="payment-made-amount"
                  inputMode="decimal"
                  value={amount}
                  disabled={!canRecord}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="payment-made-currency">Currency</Label>
                <Input id="payment-made-currency" value={currency} disabled />
              </div>
            </div>
            {!vendorId || !amount ? (
              <FieldMessage error>
                Choose a vendor and enter an amount to record this payment.
              </FieldMessage>
            ) : null}
            {canRecord ? (
              <div className="rb-dialog-footer">
                <Button
                  type="button"
                  onClick={() => void recordPayment()}
                  loading={busy === 'record'}
                  disabled={!vendorId || !amount}
                >
                  <Save aria-hidden="true" /> Record payment
                </Button>
              </div>
            ) : null}
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={payment?.paymentNumber ?? 'Payment'}
        description="Apply this payment against the vendor's open bills."
        actions={
          <Button asChild variant="outline">
            <Link href="/payments-made">Back to payments</Link>
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
        {!payment && !error ? <Skeleton /> : null}

        {payment ? (
          <Card className="rb-journal-editor">
            <div className="rb-journal-editor__meta">
              <div className="rb-field">
                <Label>Vendor</Label>
                <Input value={payment.vendorName} disabled />
              </div>
              <div className="rb-field">
                <Label>Amount</Label>
                <Input value={formatMinor(payment.amountMinor, payment.currency)} disabled />
              </div>
              <div className="rb-field">
                <Label>Allocated</Label>
                <Input value={formatMinor(payment.allocatedMinor, payment.currency)} disabled />
              </div>
              <div className="rb-field">
                <Label>Unapplied</Label>
                <Input value={formatMinor(payment.unappliedMinor, payment.currency)} disabled />
              </div>
              <StatusBadge status={payment.status} />
            </div>

            {openBills.length === 0 ? (
              <EmptyState
                title="No open bills"
                description="This vendor has no issued bills with an outstanding balance to apply this payment against."
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
                    <span>Unapplied {formatMinor(payment.unappliedMinor, currency)}</span>
                    {exceedsUnapplied ? (
                      <Badge tone="danger">Exceeds the payment&apos;s unapplied amount</Badge>
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
      </div>
    </>
  );
}

function decimalToMinor(value: string, scale = 2): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${whole}${fraction.padEnd(scale, '0').slice(0, scale)}`.replace(/^0+(?=\d)/, '');
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
