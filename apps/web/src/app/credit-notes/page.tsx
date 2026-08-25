import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { CreditNotesPage } from '../../components/credit-notes-workbench';

export const metadata: Metadata = { title: 'Credit notes | RetailBooks' };

export default function CreditNotesRoute() {
  return (
    <AppShell>
      <CreditNotesPage />
    </AppShell>
  );
}
