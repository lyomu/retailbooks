import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { SalesOrdersPage } from '../../components/sales-orders-workbench';

export const metadata: Metadata = { title: 'Sales orders | RetailBooks' };

export default function SalesOrdersRoute() {
  return (
    <AppShell>
      <SalesOrdersPage />
    </AppShell>
  );
}
