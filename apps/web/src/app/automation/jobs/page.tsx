import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { AutomationJobsPage } from '../../../components/automation-jobs-workbench';

export const metadata: Metadata = { title: 'Job failures | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <AutomationJobsPage />
    </AppShell>
  );
}
