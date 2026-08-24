import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { InvoiceEditorPage } from '../../../components/invoices-workbench';

export const metadata: Metadata = { title: 'New invoice | RetailBooks' };

export default function NewInvoiceRoute() {
  return (
    <AppShell>
      <InvoiceEditorPage />
    </AppShell>
  );
}
