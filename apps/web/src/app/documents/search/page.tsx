import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { DocumentSearchPage } from '../../../components/document-search-workbench';

export const metadata: Metadata = { title: 'Search documents | RetailBooks' };

export default function DocumentSearchRoute() {
  return (
    <AppShell>
      <DocumentSearchPage />
    </AppShell>
  );
}
