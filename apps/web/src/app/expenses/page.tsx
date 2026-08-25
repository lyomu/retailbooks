import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ExpensesPage } from '../../components/expenses-workbench';

export const metadata: Metadata = { title: 'Expenses | RetailBooks' };

export default function ExpensesRoute() {
  return (
    <AppShell>
      <ExpensesPage />
    </AppShell>
  );
}
