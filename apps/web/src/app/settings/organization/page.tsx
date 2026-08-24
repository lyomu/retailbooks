import { PageHeader } from '@retailbooks/ui';
import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { OrganizationSettings } from '../../../components/organization-settings';

export const metadata: Metadata = { title: 'Organization profile | RetailBooks' };

export default function OrganizationSettingsPage() {
  return (
    <AppShell>
      <PageHeader
        title="Organization profile"
        description="Legal identity, jurisdiction, accounting basis, and tax defaults."
      />
      <OrganizationSettings />
    </AppShell>
  );
}
