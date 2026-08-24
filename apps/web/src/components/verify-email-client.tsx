'use client';

import { Button } from '@retailbooks/ui';
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { apiRequest, ApiError } from '../lib/api';

type State = 'working' | 'success' | 'error';

export function VerifyEmailClient({ token }: { token: string }) {
  const started = useRef(false);
  const [state, setState] = useState<State>(token ? 'working' : 'error');
  const [message, setMessage] = useState(
    token ? 'Confirming your secure link…' : 'This verification link is incomplete.',
  );

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    void apiRequest<{ data: { message: string } }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((response) => {
        setState('success');
        setMessage(response.data.message);
      })
      .catch((error: unknown) => {
        setState('error');
        setMessage(
          error instanceof ApiError ? error.message : 'We could not verify this link. Try again.',
        );
      });
  }, [token]);

  return (
    <div className="rb-auth-status" role="status" aria-live="polite">
      <span className={`rb-auth-status__icon rb-auth-status__icon--${state}`}>
        {state === 'working' ? <LoaderCircle className="rb-spinner" aria-hidden="true" /> : null}
        {state === 'success' ? <CircleCheck aria-hidden="true" /> : null}
        {state === 'error' ? <CircleAlert aria-hidden="true" /> : null}
      </span>
      <h2>
        {state === 'working'
          ? 'Verifying your email'
          : state === 'success'
            ? 'Email verified'
            : 'Link not verified'}
      </h2>
      <p>{message}</p>
      {state === 'success' ? (
        <Button asChild>
          <Link href="/login">Continue to sign in</Link>
        </Button>
      ) : null}
      {state === 'error' ? (
        <Button asChild variant="outline">
          <Link href="/login">Return to sign in</Link>
        </Button>
      ) : null}
    </div>
  );
}
