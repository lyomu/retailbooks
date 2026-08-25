'use client';

import type { Vendor } from '@retailbooks/contracts';
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

type VendorResponse = { data: Vendor };
type VendorListResponse = { data: Vendor[] };
type DuplicateMatch = { id: string; displayName: string; matchedOn: 'displayName' | 'taxId' };

export function VendorsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'vendors.view');
  const canManage = hasPermission(organization, 'vendors.manage');
  const canOverrideCurrency = hasPermission(organization, 'vendors.currency_override');

  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[] | null>(null);
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<VendorListResponse>(
        `/organizations/${organizationId}/vendors${query}`,
      );
      setVendors(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Vendors could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return vendors ?? [];
    return (vendors ?? []).filter((vendor) =>
      `${vendor.displayName} ${vendor.email ?? ''}`.toLowerCase().includes(needle),
    );
  }, [vendors, query]);

  async function saveVendor(body: Record<string, unknown>) {
    if (!organizationId) return;
    if (editing) {
      await apiRequest(`/organizations/${organizationId}/vendors/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setNotice(`${body.displayName as string} was updated.`);
    } else {
      await apiRequest(`/organizations/${organizationId}/vendors`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNotice(`${body.displayName as string} was added.`);
    }
    setEditing(null);
    setShowCreate(false);
    setDuplicateMatches(null);
    setPendingBody(null);
    await load();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const tags = formValue(data, 'tags');
    const body: Record<string, unknown> = {
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
      const displayName = body.displayName as string;
      const renamed = editing && editing.displayName.toLowerCase() !== displayName.toLowerCase();
      if (!editing || renamed) {
        const check = await apiRequest<{ data: { matches: DuplicateMatch[] } }>(
          `/organizations/${organizationId}/vendors/check-duplicate?displayName=${encodeURIComponent(displayName)}`,
        );
        if (check.data.matches.length > 0) {
          setDuplicateMatches(check.data.matches);
          setPendingBody(body);
          setSaving(false);
          return;
        }
      }
      await saveVendor(body);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The vendor could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDuplicateAndSave() {
    if (!pendingBody) return;
    setSaving(true);
    setError(null);
    try {
      await saveVendor({ ...pendingBody, confirmDuplicate: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The vendor could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(vendor: Vendor, status: 'ACTIVE' | 'INACTIVE') {
    if (!organizationId) return;
    setError(null);
    try {
      const action = status === 'ACTIVE' ? 'reactivate' : 'deactivate';
      await apiRequest<VendorResponse>(
        `/organizations/${organizationId}/vendors/${vendor.id}/${action}`,
        { method: 'POST' },
      );
      setNotice(
        `${vendor.displayName} was ${status === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The vendor status could not be changed.',
      );
    }
  }

  const columns: readonly DataTableColumn<Vendor>[] = [
    {
      key: 'name',
      header: 'Vendor',
      cell: (vendor) => (
        <>
          <strong>{vendor.displayName}</strong>
          {vendor.email ? <span> {vendor.email}</span> : null}
        </>
      ),
    },
    { key: 'currency', header: 'Currency', cell: (vendor) => vendor.currency },
    {
      key: 'status',
      header: 'Status',
      cell: (vendor) => <StatusBadge status={vendor.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (vendor) =>
        canManage ? (
          <div className="rb-inline-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(vendor);
                setDuplicateMatches(null);
                setPendingBody(null);
              }}
            >
              Edit
            </Button>
            {vendor.status === 'ACTIVE' ? (
              <Button variant="ghost" size="sm" onClick={() => void setStatus(vendor, 'INACTIVE')}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void setStatus(vendor, 'ACTIVE')}>
                Reactivate
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant vendor access." />
    );
  }

  const formTarget = editing;
  const formOpen = showCreate || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Everyone your organization pays."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setShowCreate(true);
                setDuplicateMatches(null);
                setPendingBody(null);
              }}
            >
              <Plus aria-hidden="true" /> Add vendor
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
            {duplicateMatches && duplicateMatches.length > 0 ? (
              <div className="rb-auth-error" role="alert">
                <p>
                  This looks like an existing vendor:{' '}
                  {duplicateMatches.map((match) => match.displayName).join(', ')}. Create it anyway?
                </p>
                <div className="rb-dialog-footer">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDuplicateMatches(null);
                      setPendingBody(null);
                    }}
                  >
                    Go back
                  </Button>
                  <Button
                    type="button"
                    loading={saving}
                    onClick={() => void confirmDuplicateAndSave()}
                  >
                    <Save aria-hidden="true" /> Create anyway
                  </Button>
                </div>
              </div>
            ) : (
              <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
                <div className="rb-ledger-form__heading">
                  <h2>{formTarget ? `Edit ${formTarget.displayName}` : 'Add vendor'}</h2>
                </div>
                <div className="rb-field-grid">
                  <div className="rb-field">
                    <Label htmlFor="vendor-display-name">Display name</Label>
                    <Input
                      id="vendor-display-name"
                      name="displayName"
                      defaultValue={formTarget?.displayName ?? ''}
                      required
                      maxLength={160}
                    />
                  </div>
                  <div className="rb-field">
                    <Label htmlFor="vendor-legal-name">Legal name</Label>
                    <Input
                      id="vendor-legal-name"
                      name="legalName"
                      defaultValue={formTarget?.legalName ?? ''}
                      maxLength={200}
                    />
                  </div>
                  <div className="rb-field">
                    <Label htmlFor="vendor-email">Email</Label>
                    <Input
                      id="vendor-email"
                      name="email"
                      type="email"
                      defaultValue={formTarget?.email ?? ''}
                    />
                  </div>
                  <div className="rb-field">
                    <Label htmlFor="vendor-phone">Phone</Label>
                    <Input id="vendor-phone" name="phone" defaultValue={formTarget?.phone ?? ''} />
                  </div>
                  <div className="rb-field">
                    <Label htmlFor="vendor-currency">Currency</Label>
                    <Input
                      id="vendor-currency"
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
                    <Label htmlFor="vendor-terms">Payment terms (days)</Label>
                    <Input
                      id="vendor-terms"
                      name="paymentTermsDays"
                      type="number"
                      min={0}
                      max={365}
                      defaultValue={formTarget?.paymentTermsDays ?? ''}
                    />
                  </div>
                  <div className="rb-field">
                    <Label htmlFor="vendor-tags">Tags (comma-separated)</Label>
                    <Input
                      id="vendor-tags"
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
                    <Save aria-hidden="true" /> Save vendor
                  </Button>
                </div>
              </form>
            )}
          </Card>
        ) : null}

        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="vendor-search">
              <Search aria-hidden="true" /> Search vendors
            </Label>
            <Input
              id="vendor-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or email..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="vendor-status">Status</Label>
            <Select
              id="vendor-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All vendors</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
          <Badge>{vendors?.length ?? 0} vendors</Badge>
        </Card>

        {!vendors && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No vendors yet"
            description="Add your first vendor to start purchasing."
          />
        ) : (
          <DataTable caption="Vendors" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}
