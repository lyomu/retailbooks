import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { RemindersPage } from '../../../components/reminders-workbench';

export const metadata: Metadata = { title: 'Reminders | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <RemindersPage />
    </AppShell>
  );
}
