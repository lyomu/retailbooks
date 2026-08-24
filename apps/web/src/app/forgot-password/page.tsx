import type { Metadata } from 'next';

import { AuthForm } from '../../components/auth-form';
import { AuthShell } from '../../components/auth-shell';

export const metadata: Metadata = { title: 'Reset password | RetailBooks' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your account email and we’ll send a secure, one-time reset link."
    >
      <AuthForm mode="forgot" />
    </AuthShell>
  );
}
