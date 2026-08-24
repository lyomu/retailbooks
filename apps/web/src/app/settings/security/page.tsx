import { PageHeader } from '@retailbooks/ui';
import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { SecuritySessions } from '../../../components/security-sessions';

export const metadata: Metadata = { title: 'Account security | RetailBooks' };

export default function SecurityPage() {
  return (
    <AppShell requireOrganization={false}>
      <PageHeader
        title="Account security"
        description="Manage your password, active sessions, and future verification controls."
      />
      <SecuritySessions />
    </AppShell>
  );
}
