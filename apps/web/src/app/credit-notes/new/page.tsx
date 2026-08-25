import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { CreditNoteEditorPage } from '../../../components/credit-notes-workbench';

export const metadata: Metadata = { title: 'New credit note | RetailBooks' };

export default function NewCreditNoteRoute() {
  return (
    <AppShell>
      <CreditNoteEditorPage />
    </AppShell>
  );
}
