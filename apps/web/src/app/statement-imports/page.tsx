import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { StatementImportsPage } from '../../components/banking-workbench';

export const metadata: Metadata = { title: 'Statement imports | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <StatementImportsPage />
    </AppShell>
  );
}
