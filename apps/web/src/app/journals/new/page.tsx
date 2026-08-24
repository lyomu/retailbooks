import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { JournalEditorPage } from '../../../components/ledger-workbench';

export const metadata: Metadata = { title: 'New journal | RetailBooks' };

export default function NewJournalRoute() {
  return (
    <AppShell>
      <JournalEditorPage />
    </AppShell>
  );
}
