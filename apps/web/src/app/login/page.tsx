import type { Metadata } from 'next';

import { AuthForm } from '../../components/auth-form';
import { AuthShell } from '../../components/auth-shell';

export const metadata: Metadata = { title: 'Sign in | RetailBooks' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  const { invitation } = await searchParams;
  return (
    <AuthShell
      title="Welcome back"
      description={
        invitation
          ? 'Sign in with the invited email address to join the organization.'
          : 'Sign in to continue to your accounting workspace.'
      }
    >
      <AuthForm mode="login" invitation={invitation} />
    </AuthShell>
  );
}
