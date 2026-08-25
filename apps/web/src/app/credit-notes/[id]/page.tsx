import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { CreditNoteEditorPage } from '../../../components/credit-notes-workbench';

export const metadata: Metadata = { title: 'Credit note | RetailBooks' };

export default async function CreditNoteRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <CreditNoteEditorPage creditNoteId={id} />
    </AppShell>
  );
}
