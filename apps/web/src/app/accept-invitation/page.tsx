import type { Metadata } from 'next';

import { AcceptInvitationClient } from '../../components/accept-invitation-client';
import { AuthShell } from '../../components/auth-shell';

export const metadata: Metadata = { title: 'Join an organization | RetailBooks' };

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  return (
    <AuthShell
      title="You have been invited"
      description="Invitations are single-use and tied to the email address they were sent to."
    >
      <AcceptInvitationClient token={token} />
    </AuthShell>
  );
}
