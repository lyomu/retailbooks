import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { InvoicesPage } from '../../components/invoices-workbench';

export const metadata: Metadata = { title: 'Invoices | RetailBooks' };

export default function InvoicesRoute() {
  return (
    <AppShell>
      <InvoicesPage />
    </AppShell>
  );
}
