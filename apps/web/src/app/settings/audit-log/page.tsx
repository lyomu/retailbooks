import { PageHeader } from '@retailbooks/ui';
import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { AuditLog } from '../../../components/audit-log';

export const metadata: Metadata = { title: 'Audit log | RetailBooks' };

export default function AuditLogPage() {
  return (
    <AppShell>
      <PageHeader
        title="Audit log"
        description="A chronological record of security-relevant actions in this organization."
      />
      <AuditLog />
    </AppShell>
  );
}
