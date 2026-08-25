import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { ExpenseEditorPage } from '../../../components/expenses-workbench';

export const metadata: Metadata = { title: 'Expense | RetailBooks' };

export default async function ExpenseRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <ExpenseEditorPage expenseId={id} />
    </AppShell>
  );
}
