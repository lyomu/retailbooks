import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { InvoiceEditorPage } from '../../../components/invoices-workbench';

export const metadata: Metadata = { title: 'Invoice | RetailBooks' };

export default async function InvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <InvoiceEditorPage invoiceId={id} />
    </AppShell>
  );
}
