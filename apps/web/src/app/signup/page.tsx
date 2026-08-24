import type { Metadata } from 'next';

import { AuthForm } from '../../components/auth-form';
import { AuthShell } from '../../components/auth-shell';

export const metadata: Metadata = { title: 'Create account | RetailBooks' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  const { invitation } = await searchParams;
  return (
    <AuthShell
      title="Create your account"
      description={
        invitation
          ? 'Use the email address your invitation was sent to. You can join the organization once it is verified.'
          : 'Start with your identity. We’ll configure the organization and ledger together next.'
      }
    >
      <AuthForm mode="signup" invitation={invitation} />
    </AuthShell>
  );
}
