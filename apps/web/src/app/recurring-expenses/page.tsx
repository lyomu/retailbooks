import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { RecurringExpensesPage } from '../../components/recurring-expenses-workbench';

export const metadata: Metadata = { title: 'Recurring expenses | RetailBooks' };

export default function RecurringExpensesRoute() {
  return (
    <AppShell>
      <RecurringExpensesPage />
    </AppShell>
  );
}
