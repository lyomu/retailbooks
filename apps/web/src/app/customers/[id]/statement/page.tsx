import type { Metadata } from 'next';

import { AppShell } from '../../../../components/app-shell';
import { CustomerStatementPage } from '../../../../components/customer-statement';

export const metadata: Metadata = { title: 'Customer statement | RetailBooks' };

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <CustomerStatementPage contactId={id} />
    </AppShell>
  );
}
