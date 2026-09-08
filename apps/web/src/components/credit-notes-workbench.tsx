'use client';

import type {
  Contact,
  CreditNote,
  CreditNoteStatus,
  Item,
  OpenInvoiceForAllocation,
  TaxCode,
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
import { CheckCircle2, FilePlus2, Mail, Save, Search, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { TransactionCollaboration } from './transaction-collaboration';

type CreditNoteListResponse = { data: CreditNote[] };
type CreditNoteResponse = { data: CreditNote };
type ContactListResponse = { data: Contact[] };
type ItemListResponse = { data: Item[] };
type TaxCodeListResponse = { data: TaxCode[] };
type OpenInvoiceListResponse = { data: OpenInvoiceForAllocation[] };

const statusOptions: readonly CreditNoteStatus[] = [
  'DRAFT',
  'ISSUED',
  'APPLIED',
  'REFUNDED',
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

export function CreditNotesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'sales.credit_notes.view');
  const canManage = hasPermission(organization, 'sales.credit_notes.manage');

  const [creditNotes, setCreditNotes] = useState<CreditNote[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | CreditNoteStatus>('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<CreditNoteListResponse>(
        `/organizations/${organizationId}/credit-notes${suffix}`,
      );
      setCreditNotes(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Credit notes could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return creditNotes ?? [];
    return (creditNotes ?? []).filter((creditNote) =>
      `${creditNote.creditNoteNumber ?? ''} ${creditNote.contactName}`
        .toLowerCase()
        .includes(needle),
    );
  }, [creditNotes, query]);

  const columns: readonly DataTableColumn<CreditNote>[] = [
    {
      key: 'creditNote',
      header: 'Credit note',
      cell: (creditNote) => (
        <div>
          <strong>{creditNote.creditNoteNumber ?? 'Draft'}</strong>
          <span className="rb-table-secondary">{creditNote.contactName}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (creditNote) => <StatusBadge status={creditNote.status} />,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (creditNote) => formatMinor(creditNote.totalMinor, creditNote.currency),
    },
    {
      key: 'remaining',
      header: 'Remaining',
      align: 'right',
      cell: (creditNote) => formatMinor(creditNote.remainingMinor, creditNote.currency),
      hideBelow: 'tablet',
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      cell: (creditNote) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`/credit-notes/${creditNote.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant credit note access." />
    );
  }

  return (
    <>
      <PageHeader
        title="Credit notes"
        description="Issue credit notes and apply or refund their balance."
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/credit-notes/new">
                <FilePlus2 aria-hidden="true" /> New credit note
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
            <Label htmlFor="credit-note-search">
              <Search aria-hidden="true" /> Search credit notes
            </Label>
            <Input
              id="credit-note-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by credit note number or customer..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="credit-note-status">Status</Label>
            <Select
              id="credit-note-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All credit notes</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{creditNotes?.length ?? 0} credit notes</Badge>
        </Card>

        {!creditNotes && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No credit notes yet"
            description="Create your first credit note to start crediting customers."
          />
        ) : (
          <DataTable caption="Credit notes" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}

const CREDIT_NOTE_FLASH_NOTICE_KEY = 'rb-credit-note-notice';

export function CreditNoteEditorPage({ creditNoteId }: { creditNoteId?: string }) {
  const router = useRouter();
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'sales.credit_notes.manage');
  const canIssue = hasPermission(organization, 'sales.credit_notes.issue');
  const canVoid = hasPermission(organization, 'sales.credit_notes.void');
  const canAllocate = hasPermission(organization, 'sales.credit_notes.allocate');
  const canRefund = hasPermission(organization, 'sales.credit_notes.refund');
  const canSend = hasPermission(organization, 'sales.documents.send');

  const [customers, setCustomers] = useState<Contact[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceForAllocation[]>([]);
  const [creditNote, setCreditNote] = useState<CreditNote | null>(null);
  const [contactId, setContactId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [refundAmount, setRefundAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [
        customerResponse,
        itemResponse,
        taxCodeResponse,
        creditNoteResponse,
        openInvoicesResponse,
      ] = await Promise.all([
        apiRequest<ContactListResponse>(`/organizations/${organizationId}/customers?status=ACTIVE`),
        apiRequest<ItemListResponse>(
          `/organizations/${organizationId}/catalog/items?status=ACTIVE`,
        ),
        apiRequest<TaxCodeListResponse>(`/organizations/${organizationId}/tax/codes`),
        creditNoteId
          ? apiRequest<CreditNoteResponse>(
              `/organizations/${organizationId}/credit-notes/${creditNoteId}`,
            )
          : Promise.resolve(null),
        creditNoteId
          ? apiRequest<OpenInvoiceListResponse>(
              `/organizations/${organizationId}/credit-notes/${creditNoteId}/open-invoices`,
            )
          : Promise.resolve(null),
      ]);
      setCustomers(customerResponse.data);
      setItems(itemResponse.data);
      setTaxCodes(taxCodeResponse.data.filter((code) => code.status === 'ACTIVE'));
      if (creditNoteResponse) {
        setCreditNote(creditNoteResponse.data);
        setContactId(creditNoteResponse.data.contactId);
        setLines(
          creditNoteResponse.data.lines.length > 0
            ? creditNoteResponse.data.lines.map((line) => ({
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
      setOpenInvoices(openInvoicesResponse?.data ?? []);
      setAllocationAmounts({});
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The credit note could not be loaded.');
    }
  }, [creditNoteId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const flash = window.sessionStorage.getItem(CREDIT_NOTE_FLASH_NOTICE_KEY);
    if (!flash) return;
    window.sessionStorage.removeItem(CREDIT_NOTE_FLASH_NOTICE_KEY);
    setNotice(flash);
  }, [creditNoteId]);

  const contact = customers.find((candidate) => candidate.id === contactId) ?? null;
  const currency = contact?.currency ?? creditNote?.currency ?? organization?.baseCurrency ?? 'KES';

  const subtotalPreviewMinor = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + previewLineTotalMinor(line.quantity, line.unitPrice, line.discount),
        0n,
      ),
    [lines],
  );

  const posted = creditNote ? creditNote.status !== 'DRAFT' : false;
  const editable = !posted && canManage;

  const totalToApplyMinor = useMemo(
    () =>
      Object.values(allocationAmounts).reduce(
        (sum, value) => sum + (value ? BigInt(decimalToMinor(value)) : 0n),
        0n,
      ),
    [allocationAmounts],
  );
  const remainingMinor = creditNote ? BigInt(creditNote.remainingMinor) : 0n;
  const exceedsRemainingForAllocation = totalToApplyMinor > remainingMinor;
  const canSubmitAllocation =
    canAllocate && totalToApplyMinor > 0n && !exceedsRemainingForAllocation;

  const refundAmountMinor = refundAmount ? BigInt(decimalToMinor(refundAmount)) : 0n;
  const exceedsRemainingForRefund = refundAmountMinor > remainingMinor;
  const canSubmitRefund = canRefund && refundAmountMinor > 0n && !exceedsRemainingForRefund;

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
      const response = await apiRequest<CreditNoteResponse>(
        creditNoteId
          ? `/organizations/${organizationId}/credit-notes/${creditNoteId}`
          : `/organizations/${organizationId}/credit-notes`,
        { method: creditNoteId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      setCreditNote(response.data);
      if (!creditNoteId) {
        window.sessionStorage.setItem(CREDIT_NOTE_FLASH_NOTICE_KEY, 'Draft saved.');
        router.replace(`/credit-notes/${response.data.id}`);
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

  async function issueCreditNote() {
    if (!organizationId || !creditNote?.id) return;
    setBusy('issue');
    setError(null);
    try {
      const response = await apiRequest<CreditNoteResponse>(
        `/organizations/${organizationId}/credit-notes/${creditNote.id}/issue`,
        { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setCreditNote(response.data);
      setNotice(`Issued as ${response.data.creditNoteNumber}.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The credit note could not be issued.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function voidCreditNote() {
    if (!organizationId || !creditNote?.id) return;
    setBusy('void');
    setError(null);
    try {
      const response = await apiRequest<CreditNoteResponse>(
        `/organizations/${organizationId}/credit-notes/${creditNote.id}/void`,
        { method: 'POST' },
      );
      setCreditNote(response.data);
      setNotice('Credit note voided.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The credit note could not be voided.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function allocate() {
    if (!organizationId || !creditNote) return;
    const allocations = Object.entries(allocationAmounts)
      .filter(([, value]) => value.trim() !== '')
      .map(([invoiceId, value]) => ({ invoiceId, amountMinor: decimalToMinor(value) }));
    if (allocations.length === 0) return;
    setBusy('allocate');
    setError(null);
    try {
      const response = await apiRequest<CreditNoteResponse>(
        `/organizations/${organizationId}/credit-notes/${creditNote.id}/allocate`,
        {
          method: 'POST',
          body: JSON.stringify({ allocations }),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      );
      setCreditNote(response.data);
      setNotice('Credit note allocated.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The allocation could not be applied.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function refund() {
    if (!organizationId || !creditNote || !refundAmount) return;
    setBusy('refund');
    setError(null);
    try {
      const response = await apiRequest<CreditNoteResponse>(
        `/organizations/${organizationId}/credit-notes/${creditNote.id}/refund`,
        {
          method: 'POST',
          body: JSON.stringify({ amountMinor: decimalToMinor(refundAmount) }),
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      );
      setCreditNote(response.data);
      setRefundAmount('');
      setNotice('Refund recorded.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The refund could not be recorded.');
    } finally {
      setBusy(null);
    }
  }

  async function sendCreditNote() {
    if (!organizationId || !creditNote?.id) return;
    setBusy('send');
    setError(null);
    try {
      const response = await apiRequest<CreditNoteResponse>(
        `/organizations/${organizationId}/credit-notes/${creditNote.id}/send`,
        { method: 'POST' },
      );
      setCreditNote(response.data);
      setNotice('Credit note sent.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The credit note could not be sent.');
    } finally {
      setBusy(null);
    }
  }

  const canVoidNow =
    creditNote &&
    creditNote.status === 'ISSUED' &&
    creditNote.remainingMinor === creditNote.totalMinor &&
    canVoid;
  const canSendNow =
    creditNote && creditNote.status !== 'DRAFT' && creditNote.status !== 'VOID' && canSend;
  const hasRemainingBalance = creditNote && creditNote.status === 'ISSUED';

  return (
    <>
      <PageHeader
        title={creditNote?.creditNoteNumber ?? (creditNoteId ? 'Credit note' : 'New credit note')}
        description={
          posted
            ? 'Issued credit notes are immutable. Void to reverse one with nothing applied or refunded.'
            : 'Build a draft, then issue to post it to the ledger.'
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/credit-notes">Back to credit notes</Link>
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
        {creditNoteId && !creditNote && !error ? <Skeleton /> : null}

        <Card className="rb-journal-editor">
          <div className="rb-journal-editor__meta">
            <div className="rb-field">
              <Label htmlFor="credit-note-customer">Customer</Label>
              <Select
                id="credit-note-customer"
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
              <Label htmlFor="credit-note-currency">Currency</Label>
              <Input id="credit-note-currency" value={currency} disabled />
            </div>
            {creditNote ? <StatusBadge status={creditNote.status} /> : null}
          </div>

          <div className="rb-journal-lines" role="table" aria-label="Credit note lines">
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
              {creditNote && creditNote.status !== 'DRAFT' ? (
                <>
                  <span>Tax {formatMinor(creditNote.taxTotalMinor, currency)}</span>
                  <span>Total {formatMinor(creditNote.totalMinor, currency)}</span>
                  <span>Remaining {formatMinor(creditNote.remainingMinor, currency)}</span>
                </>
              ) : (
                <Badge tone="info">Tax is calculated when the credit note is issued</Badge>
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
              {creditNote?.status === 'DRAFT' && canIssue ? (
                <Button
                  type="button"
                  onClick={() => void issueCreditNote()}
                  loading={busy === 'issue'}
                >
                  <CheckCircle2 aria-hidden="true" /> Issue
                </Button>
              ) : null}
              {canVoidNow ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void voidCreditNote()}
                  loading={busy === 'void'}
                >
                  <XCircle aria-hidden="true" /> Void
                </Button>
              ) : null}
              {canSendNow ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void sendCreditNote()}
                  loading={busy === 'send'}
                >
                  <Mail aria-hidden="true" /> Send
                </Button>
              ) : null}
            </div>
          </div>
          {!contactId && editable ? (
            <FieldMessage error>Choose a customer before saving this credit note.</FieldMessage>
          ) : null}
        </Card>

        {hasRemainingBalance ? (
          <>
            <Card className="rb-journal-editor">
              <PageHeader
                title="Allocate against invoices"
                description="Apply this credit note's remaining balance against the customer's open invoices."
              />
              {openInvoices.length === 0 ? (
                <EmptyState
                  title="No open invoices"
                  description="This customer has no issued invoices with an outstanding balance."
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
                      <span>Remaining {formatMinor(creditNote.remainingMinor, currency)}</span>
                      {exceedsRemainingForAllocation ? (
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

            {canRefund ? (
              <Card className="rb-journal-editor">
                <PageHeader
                  title="Refund"
                  description="Pay out the remaining balance to the customer in cash."
                />
                <div className="rb-journal-editor__meta">
                  <div className="rb-field">
                    <Label htmlFor="credit-note-refund-amount">Amount</Label>
                    <Input
                      id="credit-note-refund-amount"
                      inputMode="decimal"
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  {exceedsRemainingForRefund ? (
                    <Badge tone="danger">Exceeds the remaining balance</Badge>
                  ) : null}
                </div>
                <div className="rb-dialog-footer">
                  <Button
                    type="button"
                    onClick={() => void refund()}
                    loading={busy === 'refund'}
                    disabled={!canSubmitRefund}
                  >
                    <CheckCircle2 aria-hidden="true" /> Refund
                  </Button>
                </div>
              </Card>
            ) : null}
          </>
        ) : null}
        {organizationId && creditNoteId ? (
          <TransactionCollaboration
            organizationId={organizationId}
            targetType="CREDIT_NOTE"
            targetId={creditNoteId}
            canComment={hasPermission(organization, 'collaboration.comments.create')}
            canUpload={
              hasPermission(organization, 'collaboration.attachments.upload') &&
              hasPermission(organization, 'sales.credit_notes.manage')
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
