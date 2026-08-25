import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { BillsPage } from '../../components/bills-workbench';

export const metadata: Metadata = { title: 'Bills | RetailBooks' };

export default function BillsRoute() {
  return (
    <AppShell>
      <BillsPage />
    </AppShell>
  );
}
