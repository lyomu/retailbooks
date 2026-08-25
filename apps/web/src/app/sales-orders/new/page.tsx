import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { SalesOrderEditorPage } from '../../../components/sales-orders-workbench';

export const metadata: Metadata = { title: 'New sales order | RetailBooks' };

export default function NewSalesOrderRoute() {
  return (
    <AppShell>
      <SalesOrderEditorPage />
    </AppShell>
  );
}
