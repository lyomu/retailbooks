import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { DataTable, type DataTableColumn } from './data-table';
import { Dialog, DialogContent, DialogTrigger } from './dialog';
import { CurrencySelect, MoneyInput } from './currency';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

async function expectNoAccessibilityViolations(): Promise<void> {
  const results = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
}

describe('RetailBooks UI accessibility', () => {
  it('exposes loading button state without losing its accessible name', async () => {
    render(<Button loading>Save journal</Button>);

    const button = screen.getByRole('button', { name: 'Save journal' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await expectNoAccessibilityViolations();
  });

  it('opens a labelled dialog and moves focus inside it', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Close period</Button>
        </DialogTrigger>
        <DialogContent title="Close fiscal period" description="Confirm the period close.">
          <Button>Confirm close</Button>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Close period' }));
    expect(screen.getByRole('dialog', { name: 'Close fiscal period' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    await expectNoAccessibilityViolations();
  });

  it('supports keyboard navigation between tabs', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <Tabs defaultValue="drafts">
          <TabsList aria-label="Journal states">
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
            <TabsTrigger value="posted">Posted</TabsTrigger>
          </TabsList>
          <TabsContent value="drafts">Draft journal list</TabsContent>
          <TabsContent value="posted">Posted journal list</TabsContent>
        </Tabs>
      </main>,
    );

    const drafts = screen.getByRole('tab', { name: 'Drafts' });
    drafts.focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('tab', { name: 'Posted' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Posted journal list')).toBeVisible();
    await expectNoAccessibilityViolations();
  });

  it('renders semantic tables and a clear empty state', async () => {
    type Row = { id: string; name: string };
    const columns: readonly DataTableColumn<Row>[] = [
      { key: 'name', header: 'Account', cell: (row) => row.name },
    ];

    render(
      <main>
        <DataTable
          caption="Chart of accounts"
          columns={columns}
          rows={[]}
          emptyTitle="No accounts yet"
          emptyDescription="Create the first account to continue."
        />
      </main>,
    );

    expect(screen.getByRole('table', { name: 'Chart of accounts' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('No accounts yet')).toBeVisible();
    await expectNoAccessibilityViolations();
  });

  it('keeps currency and money inputs explicitly labelled', async () => {
    render(
      <main>
        <label htmlFor="currency">Currency</label>
        <CurrencySelect
          id="currency"
          currencies={[{ code: 'KES', name: 'Kenyan shilling', symbol: 'KSh' }]}
        />
        <label htmlFor="amount">Amount</label>
        <MoneyInput id="amount" currency="KES" symbol="KSh" defaultValue="1250.00" />
      </main>,
    );

    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('KES');
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveAttribute('data-currency', 'KES');
    await expectNoAccessibilityViolations();
  });
});
