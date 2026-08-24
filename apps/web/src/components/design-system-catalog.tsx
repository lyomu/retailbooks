'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  Dialog,
  DialogContent,
  DialogTrigger,
  EmptyState,
  ErrorState,
  FieldMessage,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  Spinner,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toast,
  ToastProvider,
  ToastViewport,
  type DataTableColumn,
} from '@retailbooks/ui';
import { BookOpenText, Plus, RotateCcw, Save, SearchX } from 'lucide-react';
import { useState } from 'react';

type SampleAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: string;
  status: string;
};

const sampleAccounts: readonly SampleAccount[] = [
  {
    id: '1',
    code: '1000',
    name: 'Cash and cash equivalents',
    type: 'Asset',
    balance: 'KES 0.00',
    status: 'Active',
  },
  {
    id: '2',
    code: '2000',
    name: 'Accounts payable',
    type: 'Liability',
    balance: 'KES 0.00',
    status: 'Active',
  },
  {
    id: '3',
    code: '4000',
    name: 'Operating revenue',
    type: 'Income',
    balance: 'KES 0.00',
    status: 'Draft',
  },
];

const accountColumns: readonly DataTableColumn<SampleAccount>[] = [
  {
    key: 'code',
    header: 'Code',
    cell: (account) => <strong className="rb-num">{account.code}</strong>,
  },
  { key: 'name', header: 'Account', cell: (account) => account.name },
  { key: 'type', header: 'Type', cell: (account) => account.type, hideBelow: 'tablet' },
  { key: 'balance', header: 'Balance', cell: (account) => account.balance, align: 'right' },
  { key: 'status', header: 'Status', cell: (account) => <StatusBadge status={account.status} /> },
];

function ComponentDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Open dialog</Button>
      </DialogTrigger>
      <DialogContent
        title="Close fiscal period?"
        description="Closing prevents new postings unless an authorized user reopens the period."
      >
        <div className="rb-dialog-demo-copy">
          <p>August 2026 currently has no posted journals.</p>
          <div className="rb-dialog-footer">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep open
            </Button>
            <Button onClick={() => setOpen(false)}>Close period</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DesignSystemCatalog() {
  const [toastOpen, setToastOpen] = useState(false);

  return (
    <ToastProvider swipeDirection="right">
      <PageHeader
        title="Design system"
        description="The RetailFlow operational language translated into accessible RetailBooks foundations."
        actions={
          <Button onClick={() => setToastOpen(true)}>
            <Save aria-hidden="true" /> Test notification
          </Button>
        }
      />

      <section className="rb-catalog-section" aria-labelledby="catalog-actions">
        <div className="rb-section-heading">
          <div>
            <h2 id="catalog-actions">Actions and status</h2>
            <p>Controls communicate hierarchy without introducing new visual grammar.</p>
          </div>
        </div>
        <Card>
          <CardContent className="rb-catalog-stack">
            <div className="rb-catalog-row">
              <Button>
                <Plus aria-hidden="true" /> Primary action
              </Button>
              <Button variant="outline">Outline action</Button>
              <Button variant="secondary">Secondary action</Button>
              <Button variant="ghost">Ghost action</Button>
              <Button variant="danger">Danger action</Button>
              <Button loading>Saving</Button>
              <Button disabled>Unavailable</Button>
            </div>
            <div className="rb-catalog-row">
              <Badge>Neutral</Badge>
              <Badge tone="info">Information</Badge>
              <StatusBadge status="Posted" />
              <StatusBadge status="Pending" />
              <StatusBadge status="Locked" />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="rb-catalog-section" aria-labelledby="catalog-forms">
        <div className="rb-section-heading">
          <div>
            <h2 id="catalog-forms">Forms and overlays</h2>
            <p>Every field has a visible label, recovery copy, and keyboard focus.</p>
          </div>
        </div>
        <div className="rb-catalog-two-column">
          <Card>
            <CardContent>
              <form className="rb-catalog-form" onSubmit={(event) => event.preventDefault()}>
                <div>
                  <Label htmlFor="account-name">Account name</Label>
                  <Input id="account-name" placeholder="e.g. Office expenses" />
                  <FieldMessage>Use the name shown in financial reports.</FieldMessage>
                </div>
                <div>
                  <Label htmlFor="account-type">Account type</Label>
                  <Select id="account-type" defaultValue="expense">
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="expense">Expense</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="account-note">Internal note</Label>
                  <Textarea id="account-note" placeholder="Optional accounting guidance" />
                </div>
                <div>
                  <Label htmlFor="invalid-code">Duplicate code example</Label>
                  <Input
                    id="invalid-code"
                    defaultValue="1000"
                    aria-invalid="true"
                    aria-describedby="code-error"
                  />
                  <FieldMessage error>
                    <span id="code-error">Code 1000 is already in use. Choose another code.</span>
                  </FieldMessage>
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="rb-catalog-stack">
              <ComponentDialog />
              <Button variant="outline" onClick={() => setToastOpen(true)}>
                Show success toast
              </Button>
              <div className="rb-catalog-row">
                <Spinner />
                <span>Loading state</span>
              </div>
              <Skeleton className="rb-catalog-skeleton" />
              <Skeleton className="rb-catalog-skeleton is-short" />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="rb-catalog-section" aria-labelledby="catalog-data">
        <div className="rb-section-heading">
          <div>
            <h2 id="catalog-data">Data and navigation</h2>
            <p>Dense enough for accounting work, responsive enough for smaller screens.</p>
          </div>
        </div>
        <Tabs defaultValue="table">
          <TabsList aria-label="Data component examples">
            <TabsTrigger value="table">Data table</TabsTrigger>
            <TabsTrigger value="empty">Empty state</TabsTrigger>
            <TabsTrigger value="error">Error state</TabsTrigger>
          </TabsList>
          <TabsContent value="table">
            <DataTable
              caption="Chart of accounts example"
              columns={accountColumns}
              rows={sampleAccounts}
            />
          </TabsContent>
          <TabsContent value="empty">
            <Card>
              <EmptyState
                icon={BookOpenText}
                title="No accounts match this filter"
                description="Clear the filter or create a new account to continue."
                action={
                  <Button variant="outline">
                    <Plus aria-hidden="true" /> Add account
                  </Button>
                }
              />
            </Card>
          </TabsContent>
          <TabsContent value="error">
            <Card>
              <ErrorState
                description="The account list could not be loaded. Check your connection and try again."
                action={
                  <Button variant="outline">
                    <RotateCcw aria-hidden="true" /> Try again
                  </Button>
                }
              />
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      <section className="rb-catalog-section" aria-labelledby="catalog-empty-search">
        <div className="rb-section-heading">
          <div>
            <h2 id="catalog-empty-search">Compact empty state</h2>
            <p>The same pattern works inside tables and filtered views.</p>
          </div>
        </div>
        <Card>
          <EmptyState
            icon={SearchX}
            title="No matching journals"
            description="Try a different reference, date, or status."
          />
        </Card>
      </section>

      <Toast
        open={toastOpen}
        onOpenChange={setToastOpen}
        title="Design-system notification"
        description="The toast is keyboard accessible and dismissible."
      />
      <ToastViewport />
    </ToastProvider>
  );
}
