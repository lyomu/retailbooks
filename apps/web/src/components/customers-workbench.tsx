'use client';

import type { Contact } from '@retailbooks/contracts';
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
import { Plus, Save, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';

type ContactResponse = { data: Contact };
type ContactListResponse = { data: Contact[] };

export function CustomersPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'customers.view');
  const canManage = hasPermission(organization, 'customers.manage');
  const canOverrideCurrency = hasPermission(organization, 'customers.currency_override');

  const [customers, setCustomers] = useState<Contact[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<ContactListResponse>(
        `/organizations/${organizationId}/customers${query}`,
      );
      setCustomers(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Customers could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers ?? [];
    return (customers ?? []).filter((customer) =>
      `${customer.displayName} ${customer.email ?? ''}`.toLowerCase().includes(needle),
    );
  }, [customers, query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const tags = formValue(data, 'tags');
    const body = {
      displayName: formValue(data, 'displayName'),
      legalName: formValue(data, 'legalName') || undefined,
      email: formValue(data, 'email') || undefined,
      phone: formValue(data, 'phone') || undefined,
      currency: canOverrideCurrency ? formValue(data, 'currency') || undefined : undefined,
      paymentTermsDays: formValue(data, 'paymentTermsDays')
        ? Number(formValue(data, 'paymentTermsDays'))
        : undefined,
      tags: tags
        ? tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined,
    };

    try {
      if (editing) {
        await apiRequest(`/organizations/${organizationId}/customers/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setNotice(`${body.displayName} was updated.`);
      } else {
        await apiRequest(`/organizations/${organizationId}/customers`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setNotice(`${body.displayName} was added.`);
      }
      setEditing(null);
      setShowCreate(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The customer could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(customer: Contact, status: 'ACTIVE' | 'INACTIVE') {
    if (!organizationId) return;
    setError(null);
    try {
      const action = status === 'ACTIVE' ? 'reactivate' : 'deactivate';
      await apiRequest<ContactResponse>(
        `/organizations/${organizationId}/customers/${customer.id}/${action}`,
        { method: 'POST' },
      );
      setNotice(
        `${customer.displayName} was ${status === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The customer status could not be changed.',
      );
    }
  }

  const columns: readonly DataTableColumn<Contact>[] = [
    {
      key: 'name',
      header: 'Customer',
      cell: (customer) => (
        <>
          <strong>{customer.displayName}</strong>
          {customer.email ? <span> {customer.email}</span> : null}
        </>
      ),
    },
    { key: 'currency', header: 'Currency', cell: (customer) => customer.currency },
    {
      key: 'status',
      header: 'Status',
      cell: (customer) => <StatusBadge status={customer.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (customer) =>
        canManage ? (
          <div className="rb-inline-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(customer)}>
              Edit
            </Button>
            {customer.status === 'ACTIVE' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void setStatus(customer, 'INACTIVE')}
              >
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void setStatus(customer, 'ACTIVE')}>
                Reactivate
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant customer access." />
    );
  }

  const formTarget = editing;
  const formOpen = showCreate || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone your organization invoices."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setShowCreate(true);
              }}
            >
              <Plus aria-hidden="true" /> Add customer
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
        {notice ? (
          <div className="rb-auth-notice" role="status">
            {notice}
          </div>
        ) : null}

        {formOpen ? (
          <Card className="rb-ledger-form-card">
            <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
              <div className="rb-ledger-form__heading">
                <h2>{formTarget ? `Edit ${formTarget.displayName}` : 'Add customer'}</h2>
              </div>
              <div className="rb-field-grid">
                <div className="rb-field">
                  <Label htmlFor="customer-display-name">Display name</Label>
                  <Input
                    id="customer-display-name"
                    name="displayName"
                    defaultValue={formTarget?.displayName ?? ''}
                    required
                    maxLength={160}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="customer-legal-name">Legal name</Label>
                  <Input
                    id="customer-legal-name"
                    name="legalName"
                    defaultValue={formTarget?.legalName ?? ''}
                    maxLength={200}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="customer-email">Email</Label>
                  <Input
                    id="customer-email"
                    name="email"
                    type="email"
                    defaultValue={formTarget?.email ?? ''}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="customer-phone">Phone</Label>
                  <Input id="customer-phone" name="phone" defaultValue={formTarget?.phone ?? ''} />
                </div>
                <div className="rb-field">
                  <Label htmlFor="customer-currency">Currency</Label>
                  <Input
                    id="customer-currency"
                    name="currency"
                    defaultValue={formTarget?.currency ?? organization?.baseCurrency ?? ''}
                    disabled={!canOverrideCurrency}
                    maxLength={3}
                  />
                  {!canOverrideCurrency ? (
                    <FieldMessage>
                      <span>Only members with currency-override permission can change this.</span>
                    </FieldMessage>
                  ) : null}
                </div>
                <div className="rb-field">
                  <Label htmlFor="customer-terms">Payment terms (days)</Label>
                  <Input
                    id="customer-terms"
                    name="paymentTermsDays"
                    type="number"
                    min={0}
                    max={365}
                    defaultValue={formTarget?.paymentTermsDays ?? ''}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="customer-tags">Tags (comma-separated)</Label>
                  <Input
                    id="customer-tags"
                    name="tags"
                    defaultValue={formTarget?.tags.join(', ') ?? ''}
                  />
                </div>
              </div>
              <div className="rb-dialog-footer">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setShowCreate(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  <Save aria-hidden="true" /> Save customer
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="customer-search">
              <Search aria-hidden="true" /> Search customers
            </Label>
            <Input
              id="customer-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or email..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="customer-status">Status</Label>
            <Select
              id="customer-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All customers</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
          <Badge>{customers?.length ?? 0} customers</Badge>
        </Card>

        {!customers && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Add your first customer to start invoicing."
          />
        ) : (
          <DataTable caption="Customers" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}
