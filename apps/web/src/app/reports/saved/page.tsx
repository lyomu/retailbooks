import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { SavedReportsPage } from '../../../components/reports-workbench';

export const metadata: Metadata = { title: 'Saved reports | RetailBooks' };

export default function SavedReportsRoute() {
  return (
    <AppShell>
      <SavedReportsPage />
    </AppShell>
  );
}
