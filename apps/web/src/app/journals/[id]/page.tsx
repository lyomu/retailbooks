import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { JournalEditorPage } from '../../../components/ledger-workbench';

export const metadata: Metadata = { title: 'Journal | RetailBooks' };

export default async function JournalRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <JournalEditorPage journalId={id} />
    </AppShell>
  );
}
