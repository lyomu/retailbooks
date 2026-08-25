'use client';

import type { OpeningBalanceBatch } from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
} from '@retailbooks/ui';
import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type BatchResponse = { data: OpeningBalanceBatch };
type BatchListResponse = {
  data: Array<{
    id: string;
    status: 'DRAFT' | 'VALIDATED' | 'FINALIZED' | 'VOID';
    asOfDate: string;
    description: string | null;
    lineCount: number;
    partyLineCount: number;
  }>;
};
type AccountOption = {
  id: string;
  code: string;
  name: string;
  systemKey: string | null;
  isControl: boolean;
};
type PartyOption = { id: string; displayName: string };

interface LineDraft {
  accountId: string;
  debitMinor: string;
  creditMinor: string;
  description?: string;
}
interface PartyLineDraft {
  side: 'RECEIVABLE' | 'PAYABLE';
  contactId?: string;
  vendorId?: string;
  amountMinor: string;
}

export function OpeningBalancesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'accounts.view');
  const canManage = hasPermission(organization, 'accounts.opening_balances.manage');

  const [batches, setBatches] = useState<BatchListResponse['data'] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [batch, setBatch] = useState<OpeningBalanceBatch | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [contacts, setContacts] = useState<PartyOption[]>([]);
  const [vendors, setVendors] = useState<PartyOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<BatchListResponse>(
        `/organizations/${organizationId}/opening-balances`,
      );
      setBatches(response.data);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Opening balance batches could not be loaded.',
      );
    }
  }, [organizationId]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!organizationId) return;
      try {
        const response = await apiRequest<BatchResponse>(
          `/organizations/${organizationId}/opening-balances/${id}`,
        );
        setBatch(response.data);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The batch could not be loaded.');
      }
    },
    [organizationId],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!canView || !organizationId || accounts.length > 0) return;
    void (async () => {
      try {
        const [accountsResponse, customersResponse, vendorsResponse] = await Promise.all([
          apiRequest<{ data: AccountOption[] }>(`/organizations/${organizationId}/accounts`),
          apiRequest<{ data: PartyOption[] }>(`/organizations/${organizationId}/customers`),
          apiRequest<{ data: PartyOption[] }>(`/organizations/${organizationId}/vendors`),
        ]);
        setAccounts(accountsResponse.data.filter((a) => !a.isControl));
        setContacts(customersResponse.data);
        setVendors(vendorsResponse.data);
      } catch {
        // Reference lists are optional conveniences; the batch editor still works with ids.
      }
    })();
  }, [canView, organizationId, accounts.length]);

  const editable = useMemo(
    () => Boolean(batch && (batch.status === 'DRAFT' || batch.status === 'VALIDATED') && canManage),
    [batch, canManage],
  );

  async function createBatch() {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<BatchResponse>(
        `/organizations/${organizationId}/opening-balances`,
        {
          method: 'POST',
          body: JSON.stringify({ asOfDate: new Date().toISOString().slice(0, 10) }),
        },
      );
      setActiveId(response.data.id);
      await loadList();
      await loadDetail(response.data.id);
      setNotice('A new draft batch was created.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The batch could not be created.');
    } finally {
      setBusy(false);
    }
  }

  function collectBody(asOfDate: string, description: string) {
    return {
      asOfDate,
      description: description || undefined,
      lines: (batch?.lines ?? []).map((line) => ({
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        description: line.description ?? undefined,
      })),
      partyLines: (batch?.partyLines ?? []).map((party) => ({
        side: party.side,
        contactId: party.contactId ?? undefined,
        vendorId: party.vendorId ?? undefined,
        amountMinor: party.amountMinor,
      })),
    };
  }

  async function save(asOfDate: string, description: string) {
    if (!organizationId || !batch || !editable) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<BatchResponse>(
        `/organizations/${organizationId}/opening-balances/${batch.id}`,
        { method: 'PATCH', body: JSON.stringify(collectBody(asOfDate, description)) },
      );
      setBatch(response.data);
      setNotice('Draft saved. Validation resets on every edit.');
      await loadList();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The draft could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: 'validate' | 'finalize' | 'void') {
    if (!organizationId || !batch) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest<BatchResponse>(
        `/organizations/${organizationId}/opening-balances/${batch.id}/${action}`,
        {
          method: 'POST',
          ...(action === 'void' ? { body: JSON.stringify({ reason: 'Voided from wizard' }) } : {}),
        },
      );
      setBatch(response.data);
      setNotice(`Batch ${action}d.`);
      await loadList();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : `The batch could not be ${action}d.`);
    } finally {
      setBusy(false);
    }
  }

  function updateLine(id: string, patch: Partial<LineDraft>) {
    if (!batch) return;
    setBatch({
      ...batch,
      lines: batch.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    });
  }

  function updateParty(id: string, patch: Partial<PartyLineDraft>) {
    if (!batch) return;
    setBatch({
      ...batch,
      partyLines: batch.partyLines.map((party) =>
        party.id === id ? { ...party, ...patch } : party,
      ),
    });
  }

  function addLine() {
    if (!batch) return;
    setBatch({
      ...batch,
      lines: [
        ...batch.lines,
        {
          id: `draft-${crypto.randomUUID()}`,
          accountId: '',
          debitMinor: '0',
          creditMinor: '0',
          description: null,
        },
      ],
    });
  }

  function addParty(side: 'RECEIVABLE' | 'PAYABLE') {
    if (!batch) return;
    setBatch({
      ...batch,
      partyLines: [
        ...batch.partyLines,
        {
          id: `draft-${crypto.randomUUID()}`,
          side,
          contactId: null,
          vendorId: null,
          nameSnapshot: '',
          amountMinor: '0',
        },
      ],
    });
  }

  function removeLine(id: string) {
    if (!batch) return;
    setBatch({ ...batch, lines: batch.lines.filter((line) => line.id !== id) });
  }

  function removeParty(id: string) {
    if (!batch) return;
    setBatch({ ...batch, partyLines: batch.partyLines.filter((party) => party.id !== id) });
  }

  if (!canView) return <ForbiddenState />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening balances"
        description="Bring existing books into RetailBooks: account balances plus customer and vendor-level AR/AP detail."
      />

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      ) : null}

      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold">Batches</h2>
          {canManage ? (
            <Button onClick={() => void createBatch()} disabled={busy} size="sm">
              <Plus aria-hidden className="size-4" /> New batch
            </Button>
          ) : null}
        </div>
        {batches === null ? (
          <Skeleton className="mt-3 h-16" />
        ) : batches.length === 0 ? (
          <EmptyState
            title="No opening balance batches yet"
            description="Create a batch to enter your starting balances."
          />
        ) : (
          <ul className="divide-y">
            {batches.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between py-2 text-sm">
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => {
                    setActiveId(entry.id);
                    void loadDetail(entry.id);
                  }}
                >
                  <span className="font-medium">{entry.asOfDate}</span>
                  <span className="text-slate-500">
                    {' '}
                    â€” {entry.description ?? 'Untitled batch'}
                  </span>
                </button>
                <StatusBadge status={entry.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {batch ? (
        <BatchEditor
          key={batch.id}
          batch={batch}
          accounts={accounts}
          contacts={contacts}
          vendors={vendors}
          editable={editable}
          busy={busy}
          onSave={save}
          onTransition={transition}
          onUpdateLine={updateLine}
          onUpdateParty={updateParty}
          onAddLine={addLine}
          onAddParty={addParty}
          onRemoveLine={removeLine}
          onRemoveParty={removeParty}
        />
      ) : activeId === null && batches !== null && batches.length === 0 ? null : (
        <Skeleton className="h-40" />
      )}
    </div>
  );
}

interface BatchEditorProps {
  batch: OpeningBalanceBatch;
  accounts: AccountOption[];
  contacts: PartyOption[];
  vendors: PartyOption[];
  editable: boolean;
  busy: boolean;
  onSave: (asOfDate: string, description: string) => Promise<void>;
  onTransition: (action: 'validate' | 'finalize' | 'void') => Promise<void>;
  onUpdateLine: (id: string, patch: Partial<LineDraft>) => void;
  onUpdateParty: (id: string, patch: Partial<PartyLineDraft>) => void;
  onAddLine: () => void;
  onAddParty: (side: 'RECEIVABLE' | 'PAYABLE') => void;
  onRemoveLine: (id: string) => void;
  onRemoveParty: (id: string) => void;
}

function BatchEditor(props: BatchEditorProps) {
  const {
    batch,
    accounts,
    contacts,
    vendors,
    editable,
    busy,
    onSave,
    onTransition,
    onUpdateLine,
    onUpdateParty,
    onAddLine,
    onAddParty,
    onRemoveLine,
    onRemoveParty,
  } = props;
  const [asOfDate, setAsOfDate] = useState(batch.asOfDate);
  const [description, setDescription] = useState(batch.description ?? '');

  const receivableTotal = batch.totals.receivableTotalMinor;
  const payableTotal = batch.totals.payableTotalMinor;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="ob-asof">As of date</Label>
            <Input
              id="ob-asof"
              type="date"
              value={asOfDate}
              disabled={!editable}
              onChange={(event) => setAsOfDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ob-desc">Description</Label>
            <Input
              id="ob-desc"
              value={description}
              disabled={!editable}
              placeholder="Books start"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={batch.totals.balanced ? 'success' : 'warning'}>
            {batch.totals.balanced ? 'Balanced' : 'Unbalanced'}
          </Badge>
          <StatusBadge status={batch.status} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-2 font-medium">Account</th>
              <th className="py-1 pr-2 font-medium">Debit</th>
              <th className="py-1 pr-2 font-medium">Credit</th>
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {(batch.lines ?? []).map((line) => (
              <tr key={line.id}>
                <td className="py-1 pr-2">
                  <Select
                    aria-label="Account"
                    value={line.accountId}
                    disabled={!editable}
                    onChange={(event) => onUpdateLine(line.id, { accountId: event.target.value })}
                  >
                    <option value="">Selectâ€¦</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} â€” {account.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  <Input
                    aria-label="Debit minor units"
                    value={line.debitMinor}
                    disabled={!editable}
                    inputMode="numeric"
                    onChange={(event) => onUpdateLine(line.id, { debitMinor: event.target.value })}
                  />
                </td>
                <td className="py-1 pr-2">
                  <Input
                    aria-label="Credit minor units"
                    value={line.creditMinor}
                    disabled={!editable}
                    inputMode="numeric"
                    onChange={(event) => onUpdateLine(line.id, { creditMinor: event.target.value })}
                  />
                </td>
                <td className="py-1 pr-2">
                  <Input
                    aria-label="Description"
                    value={line.description ?? ''}
                    disabled={!editable}
                    onChange={(event) => onUpdateLine(line.id, { description: event.target.value })}
                  />
                </td>
                <td className="py-1">
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove line"
                      onClick={() => onRemoveLine(line.id)}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={onAddLine}>
            <Plus aria-hidden className="size-4" /> Add account line
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border p-3">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Customers owed (AR)</h3>
            <Badge>Dr {receivableTotal}</Badge>
          </header>
          {batch.partyLines
            .filter((party) => party.side === 'RECEIVABLE')
            .map((party) => (
              <div key={party.id} className="mb-2 flex items-center gap-2">
                <Select
                  aria-label="Customer"
                  value={party.contactId ?? ''}
                  disabled={!editable}
                  onChange={(event) =>
                    onUpdateParty(party.id, { contactId: event.target.value, vendorId: undefined })
                  }
                >
                  <option value="">Selectâ€¦</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.displayName}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Amount minor units"
                  className="w-32"
                  value={party.amountMinor}
                  disabled={!editable}
                  inputMode="numeric"
                  onChange={(event) => onUpdateParty(party.id, { amountMinor: event.target.value })}
                />
                {editable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove party line"
                    onClick={() => onRemoveParty(party.id)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          {editable ? (
            <Button variant="outline" size="sm" onClick={() => onAddParty('RECEIVABLE')}>
              <Plus aria-hidden className="size-4" /> Add customer
            </Button>
          ) : null}
        </section>

        <section className="rounded-lg border p-3">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Vendors owed (AP)</h3>
            <Badge>Cr {payableTotal}</Badge>
          </header>
          {batch.partyLines
            .filter((party) => party.side === 'PAYABLE')
            .map((party) => (
              <div key={party.id} className="mb-2 flex items-center gap-2">
                <Select
                  aria-label="Vendor"
                  value={party.vendorId ?? ''}
                  disabled={!editable}
                  onChange={(event) =>
                    onUpdateParty(party.id, { vendorId: event.target.value, contactId: undefined })
                  }
                >
                  <option value="">Selectâ€¦</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.displayName}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Amount minor units"
                  className="w-32"
                  value={party.amountMinor}
                  disabled={!editable}
                  inputMode="numeric"
                  onChange={(event) => onUpdateParty(party.id, { amountMinor: event.target.value })}
                />
                {editable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove party line"
                    onClick={() => onRemoveParty(party.id)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          {editable ? (
            <Button variant="outline" size="sm" onClick={() => onAddParty('PAYABLE')}>
              <Plus aria-hidden className="size-4" /> Add vendor
            </Button>
          ) : null}
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-slate-500">
          Debits {batch.totals.debitMinor} Â· Credits {batch.totals.creditMinor}. Finalize requires
          validation and a balanced batch.
        </p>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void onSave(asOfDate, description)}>
              <Save aria-hidden className="size-4" /> Save draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void onTransition('validate')}
            >
              <ShieldCheck aria-hidden className="size-4" /> Validate
            </Button>
            <Button
              size="sm"
              disabled={busy || !batch.totals.balanced}
              onClick={() => void onTransition('finalize')}
            >
              Finalize
            </Button>
          </div>
        ) : batch.status === 'FINALIZED' ? (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => void onTransition('void')}
          >
            Void batch
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
