import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { QuotesPage } from '../../components/quotes-workbench';

export const metadata: Metadata = { title: 'Quotes | RetailBooks' };

export default function QuotesRoute() {
  return (
    <AppShell>
      <QuotesPage />
    </AppShell>
  );
}
