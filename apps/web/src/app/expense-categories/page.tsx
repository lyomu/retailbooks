import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ExpenseCategoriesPage } from '../../components/expense-categories-workbench';

export const metadata: Metadata = { title: 'Expense categories | RetailBooks' };

export default function ExpenseCategoriesRoute() {
  return (
    <AppShell>
      <ExpenseCategoriesPage />
    </AppShell>
  );
}
