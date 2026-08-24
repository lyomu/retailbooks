import type { Metadata } from 'next';

import { AuthForm } from '../../components/auth-form';
import { AuthShell } from '../../components/auth-shell';

export const metadata: Metadata = { title: 'Choose new password | RetailBooks' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  return (
    <AuthShell
      title="Choose a new password"
      description="Your new password will sign out every other active RetailBooks session."
    >
      {token ? (
        <AuthForm mode="reset" token={token} />
      ) : (
        <p className="rb-auth-error" role="alert">
          This reset link is incomplete. Request a new link to continue.
        </p>
      )}
    </AuthShell>
  );
}
