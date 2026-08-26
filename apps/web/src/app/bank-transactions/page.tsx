import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { BankTransactionsPage } from '../../components/banking-workbench';

export const metadata: Metadata = { title: 'Bank transactions | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <BankTransactionsPage />
    </AppShell>
  );
}
