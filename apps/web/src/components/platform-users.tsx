'use client';

import type { PlatformUser } from '@retailbooks/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import {
  platformQuery,
  platformRoleAtLeast,
  usePlatformSession,
  type Paginated,
} from '../lib/platform';
import { Pager, Row, StatusPill } from './platform-organizations';
import { PlatformPage } from './platform-shell';

type UserDetail = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  platformRole: string | null;
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    organizationStatus: string;
    roleKey: string;
    roleName: string;
    membershipStatus: string;
  }>;
  activeSessions: Array<{ createdAt: string; userAgent: string | null }>;
  securityEvents: Array<{ eventKey: string; severity: string; occurredAt: string }>;
};

export function PlatformUsers() {
  const [rows, setRows] = useState<PlatformUser[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ query: '', status: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiRequest<Paginated<PlatformUser>>(
        `/platform/users${platformQuery({ ...filters, page })}`,
      );
      setRows(response.data);
      setTotalRows(response.pagination.totalRows);
    } catch {
      setError('Users could not be loaded.');
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    void load();
  }

  return (
    <PlatformPage
      title="Users"
      description={`${totalRows.toLocaleString()} account${totalRows === 1 ? '' : 's'}.`}
    >
      <form className="rb-platform__filters" onSubmit={search}>
        <label>
          Search
          <input
            value={filters.query}
            placeholder="Email or name"
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
        </label>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">Any</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_VERIFICATION">Pending verification</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>

      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="rb-platform__muted">Loading users…</p>
      ) : rows.length === 0 ? (
        <p className="rb-platform__muted">No users match these filters.</p>
      ) : (
        <div className="rb-platform__table-wrap">
          <table className="rb-platform__table">
            <caption className="rb-visually-hidden">Users</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Status</th>
                <th scope="col">Verified</th>
                <th scope="col">Memberships</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Link href={`/platform/users/${row.id}`}>{row.displayName}</Link>
                    <small>{row.email}</small>
                  </th>
                  <td>
                    <StatusPill status={row.status} />
                  </td>
                  <td>{row.emailVerified ? 'Yes' : 'No'}</td>
                  <td>{row.membershipCount}</td>
                  <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} pageSize={25} totalRows={totalRows} onChange={setPage} />
    </PlatformPage>
  );
}

export function PlatformUserDetail({ userId }: { userId: string }) {
  const { session } = usePlatformSession();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canOperate = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: UserDetail }>(`/platform/users/${userId}`);
      setUser(response.data);
      setStatus(response.data.status);
    } catch {
      setError('This account could not be loaded.');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/platform/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason }),
      });
      setNotice('Account status updated. Any live sessions were revoked.');
      setReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The status could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <PlatformPage title="User">
        {error ? (
          <p className="rb-platform__alert" role="alert">
            {error}
          </p>
        ) : (
          <p className="rb-platform__muted">Loading…</p>
        )}
      </PlatformPage>
    );
  }

  return (
    <PlatformPage
      title={user.displayName}
      description={user.email}
      actions={<StatusPill status={user.status} />}
    >
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="rb-platform__grid">
        <section className="rb-platform__card" aria-label="Account">
          <h2>Account</h2>
          <dl>
            <Row label="Email verified" value={user.emailVerified ? 'Yes' : 'No'} />
            <Row label="Joined" value={new Date(user.createdAt).toLocaleDateString()} />
            <Row label="Platform role" value={user.platformRole ?? 'None'} />
            <Row label="Active sessions" value={user.activeSessions.length} />
          </dl>
          {canOperate ? (
            <>
              <label>
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </label>
              <label>
                Reason
                <input
                  value={reason}
                  minLength={4}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <p className="rb-platform__muted">
                Anything other than Active revokes this person&apos;s live sessions immediately.
              </p>
              <div className="rb-platform__actions">
                <button
                  type="button"
                  disabled={busy || status === user.status || reason.trim().length < 4}
                  onClick={() => void save()}
                >
                  Update status
                </button>
              </div>
            </>
          ) : null}
        </section>

        <section className="rb-platform__card" aria-label="Recent security events">
          <h2>Recent security events</h2>
          {user.securityEvents.length === 0 ? (
            <p className="rb-platform__muted">Nothing recorded.</p>
          ) : (
            <ul className="rb-platform__list">
              {user.securityEvents.map((event, index) => (
                <li key={`${event.eventKey}-${index}`}>
                  <span>{event.eventKey}</span>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rb-platform__card" aria-label="Memberships">
        <h2>Memberships</h2>
        {user.memberships.length === 0 ? (
          <p className="rb-platform__muted">This account belongs to no organization.</p>
        ) : (
          <div className="rb-platform__table-wrap">
            <table className="rb-platform__table">
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Role</th>
                  <th scope="col">Membership</th>
                  <th scope="col">Organization status</th>
                </tr>
              </thead>
              <tbody>
                {user.memberships.map((membership) => (
                  <tr key={membership.organizationId}>
                    <th scope="row">
                      <Link href={`/platform/organizations/${membership.organizationId}`}>
                        {membership.organizationName}
                      </Link>
                    </th>
                    <td>{membership.roleName}</td>
                    <td>{membership.membershipStatus}</td>
                    <td>
                      <StatusPill status={membership.organizationStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PlatformPage>
  );
}
