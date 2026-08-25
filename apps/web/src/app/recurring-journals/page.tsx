import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { RecurringJournalsPage } from '../../components/recurring-journals-workbench';

export const metadata: Metadata = { title: 'Recurring journals | RetailBooks' };

export default function RecurringJournalsRoute() {
  return (
    <AppShell>
      <RecurringJournalsPage />
    </AppShell>
  );
}
