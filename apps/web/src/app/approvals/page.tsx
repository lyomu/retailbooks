import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ApprovalsPage } from '../../components/approvals-workbench';

export const metadata: Metadata = { title: 'Approvals | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <ApprovalsPage />
    </AppShell>
  );
}
