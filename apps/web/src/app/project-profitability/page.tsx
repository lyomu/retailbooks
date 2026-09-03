import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ProjectProfitabilityPage } from '../../components/projects-workbench';

export const metadata: Metadata = { title: 'Project profitability | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <ProjectProfitabilityPage />
    </AppShell>
  );
}
