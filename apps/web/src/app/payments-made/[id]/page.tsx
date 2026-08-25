import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PaymentMadeEditorPage } from '../../../components/payments-made-workbench';

export const metadata: Metadata = { title: 'Payment made | RetailBooks' };

export default async function PaymentMadeRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <PaymentMadeEditorPage paymentId={id} />
    </AppShell>
  );
}
