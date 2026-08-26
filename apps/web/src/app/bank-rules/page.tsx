import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { BankRulesPage } from '../../components/banking-workbench';

export const metadata: Metadata = { title: 'Bank rules | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <BankRulesPage />
    </AppShell>
  );
}
