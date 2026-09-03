import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { ProjectDetailPage } from '../../../components/projects-workbench';

export const metadata: Metadata = { title: 'Project | RetailBooks' };

export default async function ProjectRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <ProjectDetailPage projectId={id} />
    </AppShell>
  );
}
