import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { PaymentsPage } from '../../components/payments-workbench';

export const metadata: Metadata = { title: 'Payments | RetailBooks' };

export default function PaymentsRoute() {
  return (
    <AppShell>
      <PaymentsPage />
    </AppShell>
  );
}
