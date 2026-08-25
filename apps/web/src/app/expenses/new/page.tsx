import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { ExpenseEditorPage } from '../../../components/expenses-workbench';

export const metadata: Metadata = { title: 'New expense | RetailBooks' };

export default function NewExpenseRoute() {
  return (
    <AppShell>
      <ExpenseEditorPage />
    </AppShell>
  );
}
