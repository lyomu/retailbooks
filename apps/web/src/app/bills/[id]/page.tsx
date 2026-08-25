import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { BillEditorPage } from '../../../components/bills-workbench';

export const metadata: Metadata = { title: 'Bill | RetailBooks' };

export default async function BillRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <BillEditorPage billId={id} />
    </AppShell>
  );
}
