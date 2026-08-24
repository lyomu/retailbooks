import type { Metadata } from 'next';

import { AppShell } from '../../../../components/app-shell';
import { AccountLedgerPage } from '../../../../components/ledger-workbench';

export const metadata: Metadata = { title: 'Account ledger | RetailBooks' };

export default async function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <AccountLedgerPage accountId={id} />
    </AppShell>
  );
}
