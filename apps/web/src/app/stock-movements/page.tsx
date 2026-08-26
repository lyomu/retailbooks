import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { StockMovementsPage } from '../../components/inventory-workbench';

export const metadata: Metadata = { title: 'Stock movements | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <StockMovementsPage />
    </AppShell>
  );
}
