import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PaymentEditorPage } from '../../../components/payments-workbench';

export const metadata: Metadata = { title: 'Payment | RetailBooks' };

export default async function PaymentRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <PaymentEditorPage paymentId={id} />
    </AppShell>
  );
}
