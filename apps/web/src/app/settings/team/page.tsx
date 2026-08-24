import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@retailbooks/ui';
import type { Metadata } from 'next';

import { AppShell } from '../../../components/app-shell';
import { RolePermissionsMatrix } from '../../../components/role-permissions-matrix';
import { TeamManagement } from '../../../components/team-management';

export const metadata: Metadata = { title: 'Team & roles | RetailBooks' };

export default function TeamPage() {
  return (
    <AppShell>
      <PageHeader
        title="Team & roles"
        description="Manage who can reach this organization's books and how they join."
      />
      <Tabs defaultValue="members">
        <TabsList aria-label="Team settings">
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="roles">Roles &amp; permissions</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <TeamManagement />
        </TabsContent>
        <TabsContent value="roles">
          <RolePermissionsMatrix />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
