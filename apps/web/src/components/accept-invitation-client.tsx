'use client';

import type { InvitationPreview } from '@retailbooks/contracts';
import { Button } from '@retailbooks/ui';
import { Building2, CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';

type State = 'loading' | 'ready' | 'joined' | 'error';

export function AcceptInvitationClient({ token }: { token: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<State>(token ? 'loading' : 'error');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [message, setMessage] = useState(
    token ? 'Checking your invitation…' : 'This invitation link is incomplete.',
  );
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    void apiRequest<{ data: InvitationPreview }>('/invitations/preview', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((response) => {
        setPreview(response.data);
        setState('ready');
      })
      .catch((caught: unknown) => {
        setState('error');
        setMessage(
          caught instanceof ApiError
            ? caught.message
            : 'We could not check this invitation. Try again.',
        );
      });
  }, [token]);

  async function accept() {
    setJoining(true);
    try {
      await apiRequest('/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setState('joined');
      setMessage(`You now have access to ${preview?.organizationName ?? 'the organization'}.`);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        // Signed out, or signed in as somebody else: send them through the right door first.
        const destination = preview?.accountExists ? '/login' : '/signup';
        router.push(`${destination}?invitation=${encodeURIComponent(token)}`);
        return;
      }
      setState('error');
      setMessage(
        caught instanceof ApiError ? caught.message : 'The invitation could not be accepted.',
      );
    } finally {
      setJoining(false);
    }
  }

  if (state === 'loading' || state === 'error' || state === 'joined') {
    return (
      <div className="rb-auth-status" role="status" aria-live="polite">
        <span className={`rb-auth-status__icon rb-auth-status__icon--${statusTone(state)}`}>
          {state === 'loading' ? <LoaderCircle className="rb-spinner" aria-hidden="true" /> : null}
          {state === 'joined' ? <CircleCheck aria-hidden="true" /> : null}
          {state === 'error' ? <CircleAlert aria-hidden="true" /> : null}
        </span>
        <h2>
          {state === 'loading'
            ? 'Checking your invitation'
            : state === 'joined'
              ? 'You are in'
              : 'Invitation unavailable'}
        </h2>
        <p>{message}</p>
        {state === 'joined' ? (
          <Button asChild>
            <Link href="/">Go to the workspace</Link>
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

  return (
    <div className="rb-invitation-card">
      <span className="rb-invitation-card__mark" aria-hidden="true">
        <Building2 />
      </span>
      <h2>{preview?.organizationName}</h2>
      <p>
        You were invited to join as <strong>{preview?.role ?? 'a member'}</strong> using{' '}
        <strong>{preview?.email}</strong>.
      </p>

      {preview && !preview.organizationReady ? (
        <p className="rb-invitation-card__note">
          This organization is still being set up. Try again once the owner finishes setup.
        </p>
      ) : null}

      {preview && !preview.accountExists ? (
        <>
          <p className="rb-invitation-card__note">
            Create your RetailBooks account with this email address, verify it, then return to this
            link to join.
          </p>
          <Button asChild size="lg">
            <Link href={`/signup?invitation=${encodeURIComponent(token)}`}>
              Create your account
            </Link>
          </Button>
        </>
      ) : (
        <Button
          size="lg"
          onClick={() => void accept()}
          loading={joining}
          disabled={!preview?.organizationReady}
        >
          Accept invitation
        </Button>
      )}

      <p className="rb-invitation-card__note">
        Signed in with a different email? <Link href="/login">Switch account</Link> and open this
        link again.
      </p>
    </div>
  );
}

function statusTone(state: State): 'working' | 'success' | 'error' {
  if (state === 'loading') return 'working';
  if (state === 'joined') return 'success';
  return 'error';
}
