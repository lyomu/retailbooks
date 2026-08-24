import { PageHeader } from '@retailbooks/ui';
import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { NumberingSettings } from '../../components/numbering-settings';

export const metadata: Metadata = { title: 'Numbering | RetailBooks' };

export default function NumberingPage() {
  return (
    <AppShell>
      <PageHeader
        title="Numbering"
        description="Configure journal reference prefixes, padding, and reset cadence."
      />
      <NumberingSettings />
    </AppShell>
  );
}
