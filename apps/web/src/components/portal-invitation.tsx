'use client';

import { ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';

export function PortalInvitation({ token }: { token?: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'accepted'>('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    void apiRequest<{ data: { organizationName: string; customerName: string } }>(
      '/portal-invitations/preview',
      { method: 'POST', body: JSON.stringify({ token }) },
    )
      .then(({ data }) => {
        setMessage(
          `You have been invited to view documents for ${data.customerName} from ${data.organizationName}.`,
        );
        setState('ready');
      })
      .catch(() => setState('invalid'));
  }, [token]);
  async function accept() {
    if (!token) return;
    try {
      await apiRequest('/portal-invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setState('accepted');
    } catch (error) {
      setMessage(
        error instanceof ApiError ? error.message : 'We could not accept this invitation.',
      );
      setState('invalid');
    }
  }
  return (
    <main id="main-content" className="rb-portal-state">
      <ReceiptText aria-hidden="true" />
      <h1>
        {state === 'accepted'
          ? 'Your portal is ready'
          : state === 'invalid'
            ? 'This invitation is unavailable'
            : 'Customer portal invitation'}
      </h1>
      <p>
        {state === 'loading'
          ? 'Checking your invitation…'
          : state === 'accepted'
            ? 'Your access has been confirmed.'
            : message || 'This invitation may be expired, revoked, or already used.'}
      </p>
      {state === 'ready' ? (
        <button type="button" onClick={() => void accept()}>
          Accept invitation
        </button>
      ) : (
        <Link href={state === 'accepted' ? '/portal' : '/portal/login'}>
          {state === 'accepted' ? 'Open portal' : 'Sign in'}
        </Link>
      )}
    </main>
  );
}
