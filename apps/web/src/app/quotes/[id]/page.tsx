import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { QuoteEditorPage } from '../../../components/quotes-workbench';

export const metadata: Metadata = { title: 'Quote | RetailBooks' };

export default async function QuoteRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <QuoteEditorPage quoteId={id} />
    </AppShell>
  );
}
