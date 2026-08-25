import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { QuoteEditorPage } from '../../../components/quotes-workbench';

export const metadata: Metadata = { title: 'New quote | RetailBooks' };

export default function NewQuoteRoute() {
  return (
    <AppShell>
      <QuoteEditorPage />
    </AppShell>
  );
}
