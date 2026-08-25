'use client';

import type {
  Contact,
  OpenInvoiceForAllocation,
  PaymentReceived,
  PaymentStatus,
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

type PaymentListResponse = { data: PaymentReceived[] };
type PaymentResponse = { data: PaymentReceived };
type ContactListResponse = { data: Contact[] };
type OpenInvoiceListResponse = { data: OpenInvoiceForAllocation[] };

const statusOptions: readonly PaymentStatus[] = [
  'UNAPPLIED',
  'PARTIALLY_ALLOCATED',
  'FULLY_ALLOCATED',
];

export function PaymentsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'sales.payments.view');
  const canRecord = hasPermission(organization, 'sales.payments.record');

  const [payments, setPayments] = useState<PaymentReceived[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | PaymentStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<PaymentListResponse>(
        `/organizations/${organizationId}/payments${suffix}`,
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
      `${payment.paymentNumber ?? ''} ${payment.contactName}`.toLowerCase().includes(needle),
    );
  }, [payments, query]);

  const columns: readonly DataTableColumn<PaymentReceived>[] = [
    {
      key: 'payment',
      header: 'Payment',
      cell: (payment) => (
        <div>
          <strong>{payment.paymentNumber ?? 'Payment'}</strong>
          <span className="rb-table-secondary">{payment.contactName}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (payment) => <StatusBadge status={payment.status} />,
    },
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
          <Link href={`/payments/${payment.id}`}>Open</Link>
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
        title="Payments"
        description="Record customer payments and apply them against open invoices."
        actions={
          canRecord ? (
            <Button asChild>
              <Link href="/payments/new">
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
            <Label htmlFor="payment-search">
              <Search aria-hidden="true" /> Search payments
            </Label>
            <Input
              id="payment-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by payment number or customer..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="payment-status">Status</Label>
            <Select
              id="payment-status"
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
            description="Record your first customer payment to start applying it against invoices."
          />
        ) : (
          <DataTable caption="Payments" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const PAYMENT_FLASH_NOTICE_KEY = 'rb-payment-notice';

export function PaymentEditorPage({ paymentId }: { paymentId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canRecord = hasPermission(organization, 'sales.payments.record');
  const canAllocate = hasPermission(organization, 'sales.payments.allocate');

  const [customers, setCustomers] = useState<Contact[]>([]);
  const [payment, setPayment] = useState<PaymentReceived | null>(null);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceForAllocation[]>([]);
  const [contactId, setContactId] = useState('');
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [customerResponse, paymentResponse, openInvoicesResponse] = await Promise.all([
        apiRequest<ContactListResponse>(`/organizations/${organizationId}/customers?status=ACTIVE`),
        paymentId
          ? apiRequest<PaymentResponse>(`/organizations/${organizationId}/payments/${paymentId}`)
          : Promise.resolve(null),
        paymentId
          ? apiRequest<OpenInvoiceListResponse>(
              `/organizations/${organizationId}/payments/${paymentId}/open-invoices`,
            )
          : Promise.resolve(null),
      ]);
      setCustomers(customerResponse.data);
      if (paymentResponse) {
        setPayment(paymentResponse.data);
        setContactId(paymentResponse.data.contactId);
      }
      setOpenInvoices(openInvoicesResponse?.data ?? []);
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

  const contact = customers.find((candidate) => candidate.id === contactId) ?? null;
  const currency = contact?.currency ?? payment?.currency ?? organization?.baseCurrency ?? 'KES';

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
    if (!organizationId || !contactId || !amount) return;
    setBusy('record');
    setError(null);
    try {
      const payload = {
        contactId,
        receivedDate,
        amountMinor: decimalToMinor(amount),
      };
      const response = await apiRequest<PaymentResponse>(
        `/organizations/${organizationId}/payments`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      );
      window.sessionStorage.setItem(PAYMENT_FLASH_NOTICE_KEY, 'Payment recorded.');
      router.replace(`/payments/${response.data.id}`);
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
      .map(([invoiceId, value]) => ({ invoiceId, amountMinor: decimalToMinor(value) }));
    if (allocations.length === 0) return;
    setBusy('allocate');
    setError(null);
    try {
      const response = await apiRequest<PaymentResponse>(
        `/organizations/${organizationId}/payments/${payment.id}/allocate`,
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
          description="Record a customer payment. It posts to the ledger immediately."
          actions={
            <Button asChild variant="outline">
              <Link href="/payments">Back to payments</Link>
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
                <Label htmlFor="payment-customer">Customer</Label>
                <Select
                  id="payment-customer"
                  value={contactId}
                  disabled={!canRecord}
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
                <Label htmlFor="payment-received-date">Received date</Label>
                <Input
                  id="payment-received-date"
                  type="date"
                  value={receivedDate}
                  disabled={!canRecord}
                  onChange={(event) => setReceivedDate(event.target.value)}
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="payment-amount">Amount</Label>
                <Input
                  id="payment-amount"
                  inputMode="decimal"
                  value={amount}
                  disabled={!canRecord}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="rb-field">
                <Label htmlFor="payment-currency">Currency</Label>
                <Input id="payment-currency" value={currency} disabled />
              </div>
            </div>
            {!contactId || !amount ? (
              <FieldMessage error>
                Choose a customer and enter an amount to record this payment.
              </FieldMessage>
            ) : null}
            {canRecord ? (
              <div className="rb-dialog-footer">
                <Button
                  type="button"
                  onClick={() => void recordPayment()}
                  loading={busy === 'record'}
                  disabled={!contactId || !amount}
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
        description="Apply this payment against the customer's open invoices."
        actions={
          <Button asChild variant="outline">
            <Link href="/payments">Back to payments</Link>
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
                <Label>Customer</Label>
                <Input value={payment.contactName} disabled />
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

            {openInvoices.length === 0 ? (
              <EmptyState
                title="No open invoices"
                description="This customer has no issued invoices with an outstanding balance to apply this payment against."
              />
            ) : (
              <>
                <div className="rb-journal-lines" role="table" aria-label="Open invoices">
                  <div className="rb-journal-lines__head" role="row">
                    <span>Invoice</span>
                    <span>Total</span>
                    <span>Balance</span>
                    <span>Amount to apply</span>
                  </div>
                  {openInvoices.map((invoice) => (
                    <div className="rb-journal-lines__row" role="row" key={invoice.id}>
                      <span>{invoice.invoiceNumber ?? 'Invoice'}</span>
                      <span className="rb-table-secondary rb-num">
                        {formatMinor(invoice.totalMinor, invoice.currency)}
                      </span>
                      <span className="rb-table-secondary rb-num">
                        {formatMinor(invoice.balanceMinor, invoice.currency)}
                      </span>
                      <Input
                        aria-label={`Amount to apply to invoice ${invoice.invoiceNumber ?? invoice.id}`}
                        inputMode="decimal"
                        value={allocationAmounts[invoice.id] ?? ''}
                        disabled={!canAllocate}
                        onChange={(event) =>
                          setAllocationAmounts((current) => ({
                            ...current,
                            [invoice.id]: event.target.value,
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
