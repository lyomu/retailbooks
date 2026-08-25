import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { VendorsPage } from '../../components/vendors-workbench';

export const metadata: Metadata = { title: 'Vendors | RetailBooks' };

export default function VendorsRoute() {
  return (
    <AppShell>
      <VendorsPage />
    </AppShell>
  );
}
