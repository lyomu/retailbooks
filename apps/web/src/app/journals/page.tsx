import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { JournalsPage } from '../../components/ledger-workbench';

export const metadata: Metadata = { title: 'Journals | RetailBooks' };

export default function JournalsRoute() {
  return (
    <AppShell>
      <JournalsPage />
    </AppShell>
  );
}
