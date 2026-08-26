import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { InventoryValuationPage } from '../../components/inventory-workbench';

export const metadata: Metadata = { title: 'Inventory valuation | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <InventoryValuationPage />
    </AppShell>
  );
}
