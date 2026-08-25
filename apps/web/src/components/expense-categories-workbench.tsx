'use client';

import type { ExpenseCategory, LedgerAccount } from '@retailbooks/contracts';
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
import { Plus, Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';

type CategoryListResponse = { data: ExpenseCategory[] };
type CategoryResponse = { data: ExpenseCategory };
type AccountListResponse = { data: LedgerAccount[] };

export function ExpenseCategoriesPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'purchases.expense_categories.view');
  const canManage = hasPermission(organization, 'purchases.expense_categories.manage');

  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [categoryResponse, accountResponse] = await Promise.all([
        apiRequest<CategoryListResponse>(`/organizations/${organizationId}/expense-categories`),
        apiRequest<AccountListResponse>(`/organizations/${organizationId}/accounts`),
      ]);
      setCategories(categoryResponse.data);
      setAccounts(accountResponse.data.filter((account) => account.status === 'ACTIVE'));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Expense categories could not be loaded.',
      );
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const body = { name: formValue(data, 'name'), accountId: formValue(data, 'accountId') };
    try {
      if (editing) {
        await apiRequest<CategoryResponse>(
          `/organizations/${organizationId}/expense-categories/${editing.id}`,
          { method: 'PATCH', body: JSON.stringify(body) },
        );
        setNotice(`${body.name} was updated.`);
      } else {
        await apiRequest<CategoryResponse>(`/organizations/${organizationId}/expense-categories`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setNotice(`${body.name} was added.`);
      }
      setEditing(null);
      setShowCreate(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The category could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(category: ExpenseCategory) {
    if (!organizationId) return;
    setError(null);
    try {
      await apiRequest<CategoryResponse>(
        `/organizations/${organizationId}/expense-categories/${category.id}`,
        { method: 'PATCH', body: JSON.stringify({ active: !category.active }) },
      );
      setNotice(`${category.name} was ${category.active ? 'deactivated' : 'reactivated'}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The category could not be changed.');
    }
  }

  const columns: readonly DataTableColumn<ExpenseCategory>[] = [
    { key: 'name', header: 'Category', cell: (category) => <strong>{category.name}</strong> },
    {
      key: 'account',
      header: 'Account',
      cell: (category) =>
        accounts.find((account) => account.id === category.accountId)?.name ?? category.accountId,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (category) => <StatusBadge status={category.active ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (category) =>
        canManage ? (
          <div className="rb-inline-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(category)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void toggleActive(category)}>
              {category.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        ) : null,
    },
  ];

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant expense category access." />
    );
  }

  const formTarget = editing;
  const formOpen = showCreate || Boolean(editing);

  return (
    <>
      <PageHeader
        title="Expense categories"
        description="Map purchasing categories to chart-of-accounts entries."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setShowCreate(true);
              }}
            >
              <Plus aria-hidden="true" /> Add category
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
                <h2>{formTarget ? `Edit ${formTarget.name}` : 'Add expense category'}</h2>
              </div>
              <div className="rb-field-grid">
                <div className="rb-field">
                  <Label htmlFor="category-name">Name</Label>
                  <Input
                    id="category-name"
                    name="name"
                    defaultValue={formTarget?.name ?? ''}
                    required
                    maxLength={120}
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="category-account">Account</Label>
                  <Select
                    id="category-account"
                    name="accountId"
                    defaultValue={formTarget?.accountId ?? ''}
                    required
                  >
                    <option value="">Choose account</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} {account.name}
                      </option>
                    ))}
                  </Select>
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
                  <Save aria-hidden="true" /> Save category
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card className="rb-ledger-toolbar">
          <Badge>{categories?.length ?? 0} categories</Badge>
        </Card>

        {!categories && !error ? (
          <Skeleton />
        ) : (categories ?? []).length === 0 ? (
          <EmptyState
            title="No expense categories yet"
            description="Add a category to map spend to the chart of accounts."
          />
        ) : (
          <DataTable caption="Expense categories" columns={columns} rows={categories ?? []} />
        )}
      </div>
    </>
  );
}
