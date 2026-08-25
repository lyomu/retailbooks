import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { BillEditorPage } from '../../../components/bills-workbench';

export const metadata: Metadata = { title: 'New bill | RetailBooks' };

export default function NewBillRoute() {
  return (
    <AppShell>
      <BillEditorPage />
    </AppShell>
  );
}
