import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { TimeApprovalPage } from '../../components/projects-workbench';

export const metadata: Metadata = { title: 'Time approvals | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <TimeApprovalPage />
    </AppShell>
  );
}
