import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { PaymentEditorPage } from '../../../components/payments-workbench';

export const metadata: Metadata = { title: 'New payment | RetailBooks' };

export default function NewPaymentRoute() {
  return (
    <AppShell>
      <PaymentEditorPage />
    </AppShell>
  );
}
