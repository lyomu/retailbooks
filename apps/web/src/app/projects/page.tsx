import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { ProjectsPage } from '../../components/projects-workbench';

export const metadata: Metadata = { title: 'Projects | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <ProjectsPage />
    </AppShell>
  );
}
