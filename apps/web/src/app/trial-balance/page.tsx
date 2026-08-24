import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { TrialBalancePage } from '../../components/ledger-workbench';

export const metadata: Metadata = { title: 'Trial balance | RetailBooks' };

export default function TrialBalanceRoute() {
  return (
    <AppShell>
      <TrialBalancePage />
    </AppShell>
  );
}
