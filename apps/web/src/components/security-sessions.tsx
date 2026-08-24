'use client';

import { Badge, Button, EmptyState, Skeleton } from '@retailbooks/ui';
import { Laptop, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiRequest, ApiError } from '../lib/api';

interface Session {
  id: string;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export function SecuritySessions() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const response = await apiRequest<{ data: Session[] }>('/auth/sessions');
      setSessions(response.data);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Sessions could not be loaded.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(session: Session) {
    setBusyId(session.id);
    try {
      await apiRequest(`/auth/sessions/${session.id}`, { method: 'DELETE' });
      if (session.current) {
        router.replace('/login');
        router.refresh();
      } else {
        setSessions((current) => current?.filter(({ id }) => id !== session.id) ?? []);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The session could not be revoked.');
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOthers() {
    setBusyId('others');
    try {
      await apiRequest('/auth/sessions/others', { method: 'DELETE' });
      setSessions((current) => current?.filter(({ current: isCurrent }) => isCurrent) ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Other sessions could not be revoked.');
    } finally {
      setBusyId(null);
    }
  }

  if (!sessions && !error) {
    return (
      <div className="rb-security-loading" aria-label="Loading active sessions">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="rb-security-stack">
      <section className="rb-security-section" aria-labelledby="active-sessions-title">
        <div className="rb-security-section__header">
          <div>
            <h2 id="active-sessions-title">Active sessions</h2>
            <p>Review devices that are currently signed in to your account.</p>
          </div>
          {(sessions?.length ?? 0) > 1 ? (
            <Button
              variant="outline"
              onClick={() => void revokeOthers()}
              loading={busyId === 'others'}
            >
              <LogOut aria-hidden="true" /> Sign out other sessions
            </Button>
          ) : null}
        </div>
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        {sessions?.length ? (
          <ul className="rb-session-list">
            {sessions.map((session) => {
              const mobile = /Android|iPhone|iPad|Mobile/i.test(session.userAgent ?? '');
              return (
                <li key={session.id}>
                  <span className="rb-session-list__icon">
                    {mobile ? <Smartphone aria-hidden="true" /> : <Laptop aria-hidden="true" />}
                  </span>
                  <div className="rb-session-list__copy">
                    <div>
                      <strong>{describeDevice(session.userAgent)}</strong>
                      {session.current ? <Badge tone="success">This device</Badge> : null}
                    </div>
                    <span>
                      Last active {formatDate(session.lastSeenAt)} · Signed in{' '}
                      {formatDate(session.createdAt)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => void revoke(session)}
                    loading={busyId === session.id}
                  >
                    Sign out
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : !error ? (
          <EmptyState
            title="No active sessions"
            description="Sign in again to create a new secure session."
            icon={ShieldCheck}
          />
        ) : null}
      </section>

      <section className="rb-security-section" aria-labelledby="mfa-title">
        <div className="rb-security-section__header">
          <div>
            <h2 id="mfa-title">Multi-factor authentication</h2>
            <p>An additional verification step for sensitive actions and sign-in.</p>
          </div>
          <Badge>Planned</Badge>
        </div>
        <p className="rb-security-note">
          The identity architecture is MFA-ready. Enrollment will be enabled in a later security
          milestone.
        </p>
      </section>
    </div>
  );
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown browser';
  const browser = userAgent.includes('Edg/')
    ? 'Microsoft Edge'
    : userAgent.includes('Firefox/')
      ? 'Firefox'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Web browser';
  const system = userAgent.includes('Windows')
    ? 'Windows'
    : userAgent.includes('Mac OS')
      ? 'macOS'
      : userAgent.includes('Android')
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : 'Unknown device';
  return `${browser} on ${system}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
