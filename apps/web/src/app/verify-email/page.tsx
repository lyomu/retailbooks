import type { Metadata } from 'next';

import { AuthShell } from '../../components/auth-shell';
import { VerifyEmailClient } from '../../components/verify-email-client';

export const metadata: Metadata = { title: 'Verify email | RetailBooks' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  return (
    <AuthShell
      title="Confirm your email"
      description="Email verification protects your account before organization setup begins."
    >
      <VerifyEmailClient token={token} />
    </AuthShell>
  );
}
