import type { Metadata } from 'next';
import { AuthForm } from '../../../components/auth-form';
import { AuthShell } from '../../../components/auth-shell';
export const metadata: Metadata = { title: 'Customer portal sign in | RetailBooks' };
export default function PortalLogin() {
  return (
    <AuthShell
      title="Customer portal"
      description="Sign in with the verified email address that received your portal invitation."
    >
      <AuthForm mode="login" />
    </AuthShell>
  );
}
