import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PurchaseOrderEditorPage } from '../../../components/purchase-orders-workbench';

export const metadata: Metadata = { title: 'Purchase order | RetailBooks' };

export default async function PurchaseOrderRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <PurchaseOrderEditorPage orderId={id} />
    </AppShell>
  );
}
