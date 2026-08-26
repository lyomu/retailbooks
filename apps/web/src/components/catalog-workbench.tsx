'use client';

import type { Item } from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
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

type ItemListResponse = { data: Item[] };

const itemTypes: readonly { value: Item['itemType']; label: string }[] = [
  { value: 'GOODS', label: 'Goods' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'NON_STOCK', label: 'Non-stock' },
];

export function ItemsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'catalog.view');
  const canManage = hasPermission(organization, 'catalog.manage');
  const currency = organization?.baseCurrency ?? 'KES';

  const [items, setItems] = useState<Item[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const response = await apiRequest<ItemListResponse>(
        `/organizations/${organizationId}/catalog/items${query}`,
      );
      setItems(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Items could not be loaded.');
    }
  }, [organizationId, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items ?? [];
    return (items ?? []).filter((item) =>
      `${item.name} ${item.sku ?? ''}`.toLowerCase().includes(needle),
    );
  }, [items, query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const priceAmount = formValue(data, 'unitPrice');
    const body = {
      name: formValue(data, 'name'),
      sku: formValue(data, 'sku') || undefined,
      itemType: formValue(data, 'itemType'),
      inventoryTracked: data.get('inventoryTracked') === 'on',
      reorderThreshold: formValue(data, 'reorderThreshold') || undefined,
      reorderQuantity: formValue(data, 'reorderQuantity') || undefined,
      freeDescriptionAllowed: data.get('freeDescriptionAllowed') === 'on',
      prices: priceAmount
        ? [{ currency, unitPriceMinor: String(Math.round(Number(priceAmount) * 100)) }]
        : undefined,
    };

    try {
      if (editing) {
        await apiRequest(`/organizations/${organizationId}/catalog/items/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setNotice(`${body.name} was updated.`);
      } else {
        await apiRequest(`/organizations/${organizationId}/catalog/items`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setNotice(`${body.name} was added.`);
      }
      setEditing(null);
      setShowCreate(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The item could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(item: Item, status: 'ACTIVE' | 'INACTIVE') {
    if (!organizationId) return;
    setError(null);
    try {
      const action = status === 'ACTIVE' ? 'reactivate' : 'deactivate';
      await apiRequest(`/organizations/${organizationId}/catalog/items/${item.id}/${action}`, {
        method: 'POST',
      });
      setNotice(`${item.name} was ${status === 'ACTIVE' ? 'reactivated' : 'deactivated'}.`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The item status could not be changed.',
      );
    }
  }

  const columns: readonly DataTableColumn<Item>[] = [
    {
      key: 'name',
      header: 'Item',
      cell: (item) => (
        <>
          <strong>{item.name}</strong>
          {item.sku ? <span> {item.sku}</span> : null}
        </>
      ),
    },
    { key: 'type', header: 'Type', cell: (item) => item.itemType },
    {
      key: 'inventory',
      header: 'Inventory',
      cell: (item) =>
        item.inventoryTracked ? (
          <div>
            <strong>Tracked</strong>
            <span className="rb-table-secondary">
              Reorder at {item.reorderThreshold ?? 'not set'}
            </span>
          </div>
        ) : (
          'Not tracked'
        ),
    },
    {
      key: 'price',
      header: 'Price',
      cell: (item) =>
        item.prices[0]
          ? `${item.prices[0].currency} ${(Number(item.prices[0].unitPriceMinor) / 100).toFixed(2)}`
          : '—',
    },
    { key: 'status', header: 'Status', cell: (item) => <StatusBadge status={item.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (item) =>
        canManage ? (
          <div className="rb-inline-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(item)}>
              Edit
            </Button>
            {item.status === 'ACTIVE' ? (
              <Button variant="ghost" size="sm" onClick={() => void setStatus(item, 'INACTIVE')}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void setStatus(item, 'ACTIVE')}>
                Reactivate
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant catalog access." />
    );
  }

  const formTarget = editing;
  const formOpen = showCreate || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Items & services"
        description="What you sell — priced in your organization's base currency."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setShowCreate(true);
              }}
            >
              <Plus aria-hidden="true" /> Add item
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
                <h2>{formTarget ? `Edit ${formTarget.name}` : 'Add item'}</h2>
              </div>
              <div className="rb-field-grid">
                <div className="rb-field">
                  <Label htmlFor="item-name">Name</Label>
                  <Input
                    id="item-name"
                    name="name"
                    defaultValue={formTarget?.name ?? ''}
                    required
                    maxLength={160}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-sku">SKU</Label>
                  <Input
                    id="item-sku"
                    name="sku"
                    defaultValue={formTarget?.sku ?? ''}
                    maxLength={60}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-type">Type</Label>
                  <Select
                    id="item-type"
                    name="itemType"
                    defaultValue={formTarget?.itemType ?? 'GOODS'}
                  >
                    {itemTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-price">Unit price ({currency})</Label>
                  <Input
                    id="item-price"
                    name="unitPrice"
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={
                      formTarget?.prices[0]
                        ? (Number(formTarget.prices[0].unitPriceMinor) / 100).toFixed(2)
                        : ''
                    }
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-reorder-threshold">Reorder threshold</Label>
                  <Input
                    id="item-reorder-threshold"
                    name="reorderThreshold"
                    inputMode="decimal"
                    defaultValue={formTarget?.reorderThreshold ?? ''}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-reorder-quantity">Suggested reorder quantity</Label>
                  <Input
                    id="item-reorder-quantity"
                    name="reorderQuantity"
                    inputMode="decimal"
                    defaultValue={formTarget?.reorderQuantity ?? ''}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-inventory-tracked">
                    <input
                      id="item-inventory-tracked"
                      name="inventoryTracked"
                      type="checkbox"
                      defaultChecked={formTarget?.inventoryTracked ?? false}
                    />{' '}
                    Track stock for this goods item
                  </Label>
                </div>
                <div className="rb-field">
                  <Label htmlFor="item-free-description">
                    <input
                      id="item-free-description"
                      name="freeDescriptionAllowed"
                      type="checkbox"
                      defaultChecked={formTarget?.freeDescriptionAllowed ?? true}
                    />{' '}
                    Allow free-text description on invoice lines
                  </Label>
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
                  <Save aria-hidden="true" /> Save item
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="item-search">
              <Search aria-hidden="true" /> Search items
            </Label>
            <Input
              id="item-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or SKU..."
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="item-status">Status</Label>
            <Select
              id="item-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="">All items</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
          <Badge>{items?.length ?? 0} items</Badge>
        </Card>

        {!items && !error ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <EmptyState title="No items yet" description="Add your first item or service to sell." />
        ) : (
          <DataTable caption="Items" columns={columns} rows={filtered} />
        )}
      </div>
    </>
  );
}
