'use client';

import type {
  InventoryAdjustment,
  InventoryValuation,
  Item,
  LedgerAccount,
  ReorderAdvice,
  StockMovement,
  Warehouse,
} from '@retailbooks/contracts';
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
  Textarea,
  type DataTableColumn,
} from '@retailbooks/ui';
import { ArrowRightLeft, CheckCircle2, Plus, Save, Search, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';

type ItemListResponse = { data: Item[] };
type AccountListResponse = { data: LedgerAccount[] };
type WarehouseListResponse = { data: Warehouse[] };
type WarehouseResponse = { data: Warehouse };
type StockMovementListResponse = { data: StockMovement[] };
type InventoryAdjustmentListResponse = { data: InventoryAdjustment[] };
type InventoryAdjustmentResponse = { data: InventoryAdjustment };
type ReorderAdviceResponse = { data: ReorderAdvice[] };
type InventoryValuationResponse = { data: InventoryValuation };

export function WarehousesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'inventory.warehouses.view');
  const canManage = hasPermission(organization, 'inventory.warehouses.manage');
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<WarehouseListResponse>(
        `/organizations/${organizationId}/inventory/warehouses`,
      );
      setWarehouses(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Warehouses could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: readonly DataTableColumn<Warehouse>[] = [
    {
      key: 'warehouse',
      header: 'Warehouse',
      cell: (warehouse) => (
        <div>
          <strong>{warehouse.code}</strong>
          <span className="rb-table-secondary">{warehouse.name}</span>
        </div>
      ),
    },
    { key: 'address', header: 'Address', cell: (warehouse) => warehouse.address ?? 'Not set' },
    { key: 'status', header: 'Status', cell: (warehouse) => <StatusBadge status={warehouse.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (warehouse) =>
        canManage ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(warehouse)}>
            Edit
          </Button>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for inventory warehouse access to manage locations." />;
  }

  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Locations used by tracked inventory movements and valuation layers."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setShowCreate(true)}>
              <Plus aria-hidden="true" /> Add warehouse
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {(showCreate || editing) && canManage ? (
          <WarehouseForm
            warehouse={editing}
            organizationId={organizationId}
            onCancel={() => {
              setShowCreate(false);
              setEditing(null);
            }}
            onSaved={(warehouse) => {
              setNotice(`${warehouse.code} was saved.`);
              setShowCreate(false);
              setEditing(null);
              void load();
            }}
          />
        ) : null}
        {!warehouses && !error ? (
          <Skeleton />
        ) : (warehouses ?? []).length === 0 ? (
          <EmptyState title="No warehouses" description="Create a warehouse before receiving tracked stock." />
        ) : (
          <DataTable caption="Warehouses" columns={columns} rows={warehouses ?? []} />
        )}
      </div>
    </>
  );
}

function WarehouseForm({
  warehouse,
  organizationId,
  onCancel,
  onSaved,
}: {
  warehouse: Warehouse | null;
  organizationId: string | null;
  onCancel: () => void;
  onSaved: (warehouse: Warehouse) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const body = {
      code: formValue(data, 'code').toUpperCase(),
      name: formValue(data, 'name'),
      address: formValue(data, 'address') || undefined,
      ...(warehouse ? { status: formValue(data, 'status') } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      const response = await apiRequest<WarehouseResponse>(
        warehouse
          ? `/organizations/${organizationId}/inventory/warehouses/${warehouse.id}`
          : `/organizations/${organizationId}/inventory/warehouses`,
        { method: warehouse ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The warehouse could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <h2>{warehouse ? `Edit ${warehouse.code}` : 'Add warehouse'}</h2>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="warehouse-code">Code</Label>
            <Input id="warehouse-code" name="code" defaultValue={warehouse?.code ?? ''} maxLength={32} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="warehouse-name">Name</Label>
            <Input id="warehouse-name" name="name" defaultValue={warehouse?.name ?? ''} maxLength={120} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="warehouse-address">Address</Label>
            <Input id="warehouse-address" name="address" defaultValue={warehouse?.address ?? ''} maxLength={240} />
          </div>
          {warehouse ? (
            <div className="rb-field">
              <Label htmlFor="warehouse-status">Status</Label>
              <Select id="warehouse-status" name="status" defaultValue={warehouse.status}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </div>
          ) : null}
        </div>
        <div className="rb-dialog-footer">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> Save warehouse
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function StockMovementsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'inventory.movements.view');
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const currency = organization?.baseCurrency ?? 'KES';

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const params = new URLSearchParams();
      if (itemId) params.set('itemId', itemId);
      if (warehouseId) params.set('warehouseId', warehouseId);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const [movementResponse, itemResponse, warehouseResponse] = await Promise.all([
        apiRequest<StockMovementListResponse>(`/organizations/${organizationId}/inventory/movements${suffix}`),
        apiRequest<ItemListResponse>(`/organizations/${organizationId}/catalog/items?status=ACTIVE`),
        apiRequest<WarehouseListResponse>(`/organizations/${organizationId}/inventory/warehouses`),
      ]);
      setMovements(movementResponse.data);
      setItems(itemResponse.data.filter((item) => item.inventoryTracked));
      setWarehouses(warehouseResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Stock movements could not be loaded.');
    }
  }, [itemId, organizationId, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return movements ?? [];
    return (movements ?? []).filter((movement) =>
      `${movement.itemName} ${movement.sku ?? ''} ${movement.warehouseName} ${movement.sourceType}`
        .toLowerCase()
        .includes(needle),
    );
  }, [movements, query]);

  const columns: readonly DataTableColumn<StockMovement>[] = [
    {
      key: 'item',
      header: 'Item',
      cell: (movement) => (
        <div>
          <strong>{movement.itemName}</strong>
          <span className="rb-table-secondary">{movement.sku ?? 'No SKU'}</span>
        </div>
      ),
    },
    { key: 'warehouse', header: 'Warehouse', cell: (movement) => movement.warehouseName },
    { key: 'date', header: 'Date', cell: (movement) => movement.movementDate },
    { key: 'direction', header: 'Direction', cell: (movement) => <StatusBadge status={movement.direction} /> },
    { key: 'quantity', header: 'Qty', align: 'right', cell: (movement) => movement.quantity },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      cell: (movement) => formatMinor(movement.totalCostMinor, currency),
    },
    { key: 'source', header: 'Source', cell: (movement) => label(movement.sourceType), hideBelow: 'tablet' },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for stock movement access to inspect inventory history." />;
  }

  return (
    <>
      <PageHeader
        title="Stock movements"
        description="Append-only movement history by tracked item, warehouse, source, and cost."
      />
      <div className="rb-ledger-stack">
        <Messages error={error} />
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="stock-search">
              <Search aria-hidden="true" /> Search movements
            </Label>
            <Input id="stock-search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <ItemSelect items={items} id="stock-item-filter" value={itemId} onChange={setItemId} allowAll />
          <WarehouseSelect warehouses={warehouses} id="stock-warehouse-filter" value={warehouseId} onChange={setWarehouseId} allowAll />
          <Badge>{filtered.length} movements</Badge>
        </Card>
        {!movements && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Stock movements"
            columns={columns}
            rows={filtered}
            emptyTitle="No stock movements"
            emptyDescription="Receipts, adjustments, transfers, and sales issues appear here."
          />
        )}
      </div>
    </>
  );
}

export function InventoryAdjustmentsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'inventory.adjustments.view');
  const canManage = hasPermission(organization, 'inventory.adjustments.manage');
  const canApprove = hasPermission(organization, 'inventory.adjustments.approve');
  const canPost = hasPermission(organization, 'inventory.adjustments.post');
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [status, setStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currency = organization?.baseCurrency ?? 'KES';

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const suffix = status ? `?status=${status}` : '';
      const [adjustmentResponse, itemResponse, warehouseResponse, accountResponse] = await Promise.all([
        apiRequest<InventoryAdjustmentListResponse>(`/organizations/${organizationId}/inventory/adjustments${suffix}`),
        apiRequest<ItemListResponse>(`/organizations/${organizationId}/catalog/items?status=ACTIVE`),
        apiRequest<WarehouseListResponse>(`/organizations/${organizationId}/inventory/warehouses`),
        apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
      ]);
      setAdjustments(adjustmentResponse.data);
      setItems(itemResponse.data.filter((item) => item.inventoryTracked));
      setWarehouses(warehouseResponse.data.filter((warehouse) => warehouse.status === 'ACTIVE'));
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Inventory adjustments could not be loaded.');
    }
  }, [organizationId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(adjustment: InventoryAdjustment, action: 'submit' | 'approve' | 'post' | 'cancel') {
    if (!organizationId) return;
    setBusy(`${action}:${adjustment.id}`);
    setError(null);
    try {
      await apiRequest<InventoryAdjustmentResponse>(
        `/organizations/${organizationId}/inventory/adjustments/${adjustment.id}/${action}`,
        { method: 'POST' },
      );
      setNotice(`${adjustment.itemName} adjustment ${action}ed.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : `The adjustment could not be ${action}ed.`);
    } finally {
      setBusy(null);
    }
  }

  const columns: readonly DataTableColumn<InventoryAdjustment>[] = [
    {
      key: 'item',
      header: 'Item',
      cell: (adjustment) => (
        <div>
          <strong>{adjustment.itemName}</strong>
          <span className="rb-table-secondary">{adjustment.warehouseName}</span>
        </div>
      ),
    },
    { key: 'date', header: 'Date', cell: (adjustment) => adjustment.adjustmentDate },
    { key: 'quantity', header: 'Qty delta', align: 'right', cell: (adjustment) => adjustment.quantityDelta },
    {
      key: 'value',
      header: 'Value delta',
      align: 'right',
      cell: (adjustment) => formatMinor(adjustment.valueDeltaMinor, currency),
    },
    { key: 'status', header: 'Status', cell: (adjustment) => <StatusBadge status={adjustment.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (adjustment) => (
        <div className="rb-inline-actions">
          {canManage && adjustment.status === 'DRAFT' ? (
            <Button variant="ghost" size="sm" type="button" loading={busy === `submit:${adjustment.id}`} onClick={() => void transition(adjustment, 'submit')}>
              Submit
            </Button>
          ) : null}
          {canApprove && adjustment.status === 'PENDING_APPROVAL' ? (
            <Button variant="ghost" size="sm" type="button" loading={busy === `approve:${adjustment.id}`} onClick={() => void transition(adjustment, 'approve')}>
              Approve
            </Button>
          ) : null}
          {canPost && (adjustment.status === 'DRAFT' || adjustment.status === 'APPROVED') ? (
            <Button variant="ghost" size="sm" type="button" loading={busy === `post:${adjustment.id}`} onClick={() => void transition(adjustment, 'post')}>
              Post
            </Button>
          ) : null}
          {canManage && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(adjustment.status) ? (
            <Button variant="ghost" size="sm" type="button" loading={busy === `cancel:${adjustment.id}`} onClick={() => void transition(adjustment, 'cancel')}>
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for inventory adjustment access to review stock corrections." />;
  }

  return (
    <>
      <PageHeader
        title="Inventory adjustments"
        description="Post quantity and value corrections with explicit reasons and ledger offsets."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setShowCreate((value) => !value)}>
              <Plus aria-hidden="true" /> New adjustment
            </Button>
          ) : null
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {showCreate && canManage ? (
          <InventoryAdjustmentForm
            organizationId={organizationId}
            items={items}
            warehouses={warehouses}
            accounts={accounts}
            onSaved={() => {
              setNotice('Inventory adjustment was saved.');
              setShowCreate(false);
              void load();
            }}
          />
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="adjustment-status-filter">Status</Label>
            <Select id="adjustment-status-filter" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED'].map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </Select>
          </div>
          <Badge>{adjustments?.length ?? 0} adjustments</Badge>
        </Card>
        {!adjustments && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Inventory adjustments"
            columns={columns}
            rows={adjustments ?? []}
            emptyTitle="No adjustments"
            emptyDescription="Create an adjustment for stock counts, write-offs, or value corrections."
          />
        )}
      </div>
    </>
  );
}

function InventoryAdjustmentForm({
  organizationId,
  items,
  warehouses,
  accounts,
  onSaved,
}: {
  organizationId: string | null;
  items: readonly Item[];
  warehouses: readonly Warehouse[];
  accounts: readonly LedgerAccount[];
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const valueDelta = formValue(data, 'valueDelta');
    const body = {
      itemId: formValue(data, 'itemId'),
      warehouseId: formValue(data, 'warehouseId'),
      adjustmentDate: formValue(data, 'adjustmentDate'),
      quantityDelta: formValue(data, 'quantityDelta'),
      valueDeltaMinor: valueDelta ? decimalToMinor(valueDelta) : undefined,
      reason: formValue(data, 'reason'),
      accountId: formValue(data, 'accountId') || undefined,
    };
    setSaving(true);
    setError(null);
    try {
      await apiRequest<InventoryAdjustmentResponse>(
        `/organizations/${organizationId}/inventory/adjustments`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The adjustment could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rb-ledger-form-card">
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-ledger-form__heading">
          <h2>New adjustment</h2>
        </div>
        <Messages error={error} />
        <div className="rb-field-grid">
          <ItemSelect items={items} id="adjustment-item" name="itemId" />
          <WarehouseSelect warehouses={warehouses} id="adjustment-warehouse" name="warehouseId" />
          <div className="rb-field">
            <Label htmlFor="adjustment-date">Date</Label>
            <Input id="adjustment-date" name="adjustmentDate" type="date" defaultValue={today} required />
          </div>
          <div className="rb-field">
            <Label htmlFor="adjustment-quantity">Quantity delta</Label>
            <Input id="adjustment-quantity" name="quantityDelta" inputMode="decimal" placeholder="-2 or 5" required />
          </div>
          <div className="rb-field">
            <Label htmlFor="adjustment-value">Value delta</Label>
            <Input id="adjustment-value" name="valueDelta" inputMode="decimal" placeholder="0.00" />
          </div>
          <div className="rb-field">
            <Label htmlFor="adjustment-account">Offset account</Label>
            <Select id="adjustment-account" name="accountId">
              <option value="">General expense</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="rb-field">
          <Label htmlFor="adjustment-reason">Reason</Label>
          <Textarea id="adjustment-reason" name="reason" maxLength={240} required />
        </div>
        <div className="rb-dialog-footer">
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" /> Save adjustment
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function InventoryTransfersPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'inventory.transfers.manage');
  const canView = hasPermission(organization, 'inventory.transfers.view') || canManage;
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [itemResponse, warehouseResponse] = await Promise.all([
        apiRequest<ItemListResponse>(`/organizations/${organizationId}/catalog/items?status=ACTIVE`),
        apiRequest<WarehouseListResponse>(`/organizations/${organizationId}/inventory/warehouses`),
      ]);
      setItems(itemResponse.data.filter((item) => item.inventoryTracked));
      setWarehouses(warehouseResponse.data.filter((warehouse) => warehouse.status === 'ACTIVE'));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Transfer setup data could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/inventory/transfers`, {
        method: 'POST',
        body: JSON.stringify({
          itemId: formValue(data, 'itemId'),
          fromWarehouseId: formValue(data, 'fromWarehouseId'),
          toWarehouseId: formValue(data, 'toWarehouseId'),
          transferDate: formValue(data, 'transferDate'),
          quantity: formValue(data, 'quantity'),
        }),
      });
      setNotice('Inventory transfer was posted.');
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The transfer could not be posted.');
    } finally {
      setSaving(false);
    }
  }

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for inventory transfer access to move stock between warehouses." />;
  }

  return (
    <>
      <PageHeader
        title="Inventory transfers"
        description="Move tracked stock between warehouses while total organization stock stays unchanged."
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {canManage ? (
          <Card className="rb-ledger-form-card">
            <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
              <div className="rb-ledger-form__heading">
                <h2>Post transfer</h2>
              </div>
              <div className="rb-field-grid">
                <ItemSelect items={items} id="transfer-item" name="itemId" />
                <WarehouseSelect warehouses={warehouses} id="transfer-from" name="fromWarehouseId" labelText="From warehouse" />
                <WarehouseSelect warehouses={warehouses} id="transfer-to" name="toWarehouseId" labelText="To warehouse" />
                <div className="rb-field">
                  <Label htmlFor="transfer-date">Date</Label>
                  <Input id="transfer-date" name="transferDate" type="date" defaultValue={today} required />
                </div>
                <div className="rb-field">
                  <Label htmlFor="transfer-quantity">Quantity</Label>
                  <Input id="transfer-quantity" name="quantity" inputMode="decimal" required />
                </div>
              </div>
              <div className="rb-dialog-footer">
                <Button type="submit" loading={saving}>
                  <ArrowRightLeft aria-hidden="true" /> Post transfer
                </Button>
              </div>
            </form>
          </Card>
        ) : null}
        <EmptyState title="Transfer history is in movements" description="Filter stock movements by source Transfer to audit posted transfers." />
      </div>
    </>
  );
}

export function ReorderPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'inventory.reorder.view');
  const [rows, setRows] = useState<ReorderAdvice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<ReorderAdviceResponse>(`/organizations/${organizationId}/inventory/reorder`)
      .then((response) => {
        setRows(response.data);
        setError(null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Reorder advice could not be loaded.'));
  }, [organizationId]);

  const columns: readonly DataTableColumn<ReorderAdvice>[] = [
    {
      key: 'item',
      header: 'Item',
      cell: (row) => (
        <div>
          <strong>{row.itemName}</strong>
          <span className="rb-table-secondary">{row.sku ?? 'No SKU'}</span>
        </div>
      ),
    },
    { key: 'onHand', header: 'On hand', align: 'right', cell: (row) => row.onHand },
    { key: 'threshold', header: 'Threshold', align: 'right', cell: (row) => row.reorderThreshold ?? 'Not set' },
    { key: 'suggested', header: 'Suggested', align: 'right', cell: (row) => row.suggestedQuantity ?? 'Not set' },
    { key: 'vendor', header: 'Preferred vendor', cell: (row) => row.preferredVendorName ?? 'Not set' },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for reorder access to review replenishment advice." />;
  }

  return (
    <>
      <PageHeader
        title="Reorder"
        description="Advisory replenishment list only; purchase orders are never auto-created."
      />
      <div className="rb-ledger-stack">
        <Messages error={error} />
        {!rows && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Reorder advice"
            columns={columns}
            rows={rows ?? []}
            emptyTitle="No reorder advice"
            emptyDescription="Tracked items are above their configured thresholds."
          />
        )}
      </div>
    </>
  );
}

export function InventoryValuationPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'inventory.valuation.view');
  const [valuation, setValuation] = useState<InventoryValuation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = organization?.baseCurrency ?? 'KES';

  useEffect(() => {
    if (!organizationId) return;
    apiRequest<InventoryValuationResponse>(`/organizations/${organizationId}/inventory/valuation`)
      .then((response) => {
        setValuation(response.data);
        setError(null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Inventory valuation could not be loaded.'));
  }, [organizationId]);

  const columns: readonly DataTableColumn<InventoryValuation['rows'][number]>[] = [
    {
      key: 'item',
      header: 'Item',
      cell: (row) => (
        <div>
          <strong>{row.itemName}</strong>
          <span className="rb-table-secondary">{row.sku ?? 'No SKU'}</span>
        </div>
      ),
    },
    { key: 'warehouse', header: 'Warehouse', cell: (row) => row.warehouseName },
    { key: 'quantity', header: 'On hand', align: 'right', cell: (row) => row.quantityOnHand },
    { key: 'value', header: 'Value', align: 'right', cell: (row) => formatMinor(row.valueMinor, currency) },
  ];

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for valuation access to review inventory value." />;
  }

  return (
    <>
      <PageHeader
        title="Inventory valuation"
        description="Remaining valuation layers by item and warehouse, intended to reconcile to Inventory Asset."
        actions={valuation ? <Badge>Total {formatMinor(valuation.totalValueMinor, currency)}</Badge> : null}
      />
      <div className="rb-ledger-stack">
        <Messages error={error} />
        {!valuation && !error ? (
          <Skeleton />
        ) : (
          <DataTable
            caption="Inventory valuation"
            columns={columns}
            rows={valuation?.rows ?? []}
            emptyTitle="No valuation layers"
            emptyDescription="Receive tracked stock to create valuation layers."
          />
        )}
      </div>
    </>
  );
}

function ItemSelect({
  items,
  id,
  name = id,
  value,
  onChange,
  allowAll = false,
}: {
  items: readonly Item[];
  id: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  allowAll?: boolean;
}) {
  return (
    <div className="rb-field">
      <Label htmlFor={id}>Item</Label>
      <Select id={id} name={name} value={value} onChange={(event) => onChange?.(event.target.value)} required={!allowAll}>
        {allowAll ? <option value="">All items</option> : <option value="">Choose item</option>}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.sku ? `${item.sku} ` : ''}{item.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

function WarehouseSelect({
  warehouses,
  id,
  name = id,
  value,
  onChange,
  allowAll = false,
  labelText = 'Warehouse',
}: {
  warehouses: readonly Warehouse[];
  id: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  allowAll?: boolean;
  labelText?: string;
}) {
  return (
    <div className="rb-field">
      <Label htmlFor={id}>{labelText}</Label>
      <Select id={id} name={name} value={value} onChange={(event) => onChange?.(event.target.value)} required={!allowAll}>
        {allowAll ? <option value="">All warehouses</option> : <option value="">Choose warehouse</option>}
        {warehouses.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.code} {warehouse.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Messages({ error, notice }: { error?: string | null; notice?: string | null }) {
  return (
    <>
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
    </>
  );
}

function decimalToMinor(value: string): string {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return '0';
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const minor = `${whole || '0'}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${minor || '0'}`;
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

function label(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1)}${part.slice(1).toLowerCase()}`)
    .join(' ');
}
