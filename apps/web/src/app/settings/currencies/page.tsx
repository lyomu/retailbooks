import { PageHeader } from '@retailbooks/ui';
import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { CurrencySettings } from '../../../components/currency-settings';

export const metadata: Metadata = { title: 'Currencies | RetailBooks' };

export default function CurrencySettingsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Currencies"
        description="Control transaction currencies and the effective rates used for posting."
      />
      <CurrencySettings />
    </AppShell>
  );
}
