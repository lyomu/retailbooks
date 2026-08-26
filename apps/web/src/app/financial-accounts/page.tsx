import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { FinancialAccountsPage } from '../../components/banking-workbench';

export const metadata: Metadata = { title: 'Financial accounts | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <FinancialAccountsPage />
    </AppShell>
  );
}
