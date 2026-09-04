import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { NotificationsPage } from '../../components/notifications-workbench';

export const metadata: Metadata = { title: 'Notifications | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <NotificationsPage />
    </AppShell>
  );
}
