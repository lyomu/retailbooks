import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { WorkflowRulesPage } from '../../../components/workflow-rules-workbench';

export const metadata: Metadata = { title: 'Workflow rules | RetailBooks' };

export default function Page() {
  return (
    <AppShell>
      <WorkflowRulesPage />
    </AppShell>
  );
}
