import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ChartOfAccountsPage } from '../../components/ledger-workbench';

export const metadata: Metadata = { title: 'Chart of accounts | RetailBooks' };

export default function AccountsPage() {
  return (
    <AppShell>
      <ChartOfAccountsPage />
    </AppShell>
  );
}
