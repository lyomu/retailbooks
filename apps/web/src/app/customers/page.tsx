import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { CustomersPage } from '../../components/customers-workbench';

export const metadata: Metadata = { title: 'Customers | RetailBooks' };

export default function CustomersRoute() {
  return (
    <AppShell>
      <CustomersPage />
    </AppShell>
  );
}
