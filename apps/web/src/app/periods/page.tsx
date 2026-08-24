import { PageHeader } from '@retailbooks/ui';
import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { FiscalPeriodsManagement } from '../../components/fiscal-periods-management';

export const metadata: Metadata = { title: 'Fiscal periods | RetailBooks' };

export default function PeriodsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Fiscal periods"
        description="Generate fiscal years and control which periods accept posted journals."
      />
      <FiscalPeriodsManagement />
    </AppShell>
  );
}
