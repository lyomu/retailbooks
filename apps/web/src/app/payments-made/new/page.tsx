import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PaymentMadeEditorPage } from '../../../components/payments-made-workbench';

export const metadata: Metadata = { title: 'Record payment | RetailBooks' };

export default function NewPaymentMadeRoute() {
  return (
    <AppShell>
      <PaymentMadeEditorPage />
    </AppShell>
  );
}
