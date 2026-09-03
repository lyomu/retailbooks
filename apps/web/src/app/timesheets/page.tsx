import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { TimesheetPage } from '../../components/projects-workbench';

export const metadata: Metadata = { title: 'Timesheet | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <TimesheetPage />
    </AppShell>
  );
}
