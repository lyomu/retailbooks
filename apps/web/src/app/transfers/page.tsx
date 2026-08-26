import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { TransfersPage } from '../../components/banking-workbench';

export const metadata: Metadata = { title: 'Transfers | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <TransfersPage />
    </AppShell>
  );
}
