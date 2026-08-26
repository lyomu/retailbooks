import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { InventoryTransfersPage } from '../../components/inventory-workbench';

export const metadata: Metadata = { title: 'Inventory transfers | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <InventoryTransfersPage />
    </AppShell>
  );
}
