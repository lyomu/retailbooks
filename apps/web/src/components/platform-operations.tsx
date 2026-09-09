'use client';

import type {
  PlatformAuditEvent,
  PlatformFailedJob,
  PlatformQueueHealth,
  PlatformSecurityEvent,
} from '@retailbooks/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import {
  platformQuery,
  platformRoleAtLeast,
  usePlatformSession,
  type Paginated,
} from '../lib/platform';
import { Pager } from './platform-organizations';
import { PlatformPage } from './platform-shell';

export function PlatformJobs() {
  const { session } = usePlatformSession();
  const [health, setHealth] = useState<PlatformQueueHealth | null>(null);
  const [rows, setRows] = useState<PlatformFailedJob[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const canRetry = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');

  const load = useCallback(async () => {
    try {
      const [healthResponse, jobsResponse] = await Promise.all([
        apiRequest<{ data: PlatformQueueHealth }>('/platform/jobs/health'),
        apiRequest<Paginated<PlatformFailedJob>>(`/platform/jobs/failed${platformQuery({ page })}`),
      ]);
      setHealth(healthResponse.data);
      setRows(jobsResponse.data);
      setTotalRows(jobsResponse.pagination.totalRows);
    } catch {
      setError('Job health could not be loaded.');
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(executionId: string) {
    setBusy(executionId);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/platform/jobs/${executionId}/retry`, { method: 'POST' });
      setNotice('Job requeued.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That job could not be retried.');
    } finally {
      setBusy('');
    }
  }

  return (
    <PlatformPage
      title="Jobs and queues"
      description="Queue depth is what is enqueued now; the scheduler figures are what was supposed to happen. A backlog in one and not the other is the signal worth chasing."
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

      {health ? (
        <section className="rb-platform__stats" aria-label="Queue health">
          {Object.entries(health.queues.automation).map(([key, value]) => (
            <div key={`automation-${key}`} className="rb-platform__stat">
              <span>Automation {key}</span>
              <strong>{value}</strong>
            </div>
          ))}
          {Object.entries(health.queues.email).map(([key, value]) => (
            <div key={`email-${key}`} className="rb-platform__stat">
              <span>Email {key}</span>
              <strong>{value}</strong>
            </div>
          ))}
          <div className="rb-platform__stat">
            <span>Scheduler due now</span>
            <strong>{health.scheduler.dueNow}</strong>
          </div>
          <div className="rb-platform__stat">
            <span>Running</span>
            <strong>{health.scheduler.runningNow}</strong>
          </div>
          <div
            className={`rb-platform__stat${health.scheduler.failedLastDay > 0 ? ' is-warn' : ''}`}
          >
            <span>Failed (24h)</span>
            <strong>{health.scheduler.failedLastDay}</strong>
          </div>
        </section>
      ) : (
        <p className="rb-platform__muted">Loading queue health…</p>
      )}

      <section className="rb-platform__card" aria-label="Failed executions">
        <h2>Failed executions</h2>
        {rows === null ? (
          <p className="rb-platform__muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="rb-platform__muted">Nothing has failed. </p>
        ) : (
          <div className="rb-platform__table-wrap">
            <table className="rb-platform__table">
              <thead>
                <tr>
                  <th scope="col">Handler</th>
                  <th scope="col">Organization</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Error</th>
                  <th scope="col">Failed</th>
                  <th scope="col">
                    <span className="rb-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      {row.handler}
                      <small>{row.occurrenceKey}</small>
                    </th>
                    <td>
                      <Link href={`/platform/organizations/${row.organizationId}`}>
                        {row.organizationName}
                      </Link>
                    </td>
                    <td>{row.attempts}</td>
                    <td className="rb-platform__error">{row.error ?? '—'}</td>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>
                      {canRetry ? (
                        <button
                          type="button"
                          disabled={busy === row.id}
                          onClick={() => void retry(row.id)}
                        >
                          Retry
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={25} totalRows={totalRows} onChange={setPage} />
      </section>
    </PlatformPage>
  );
}

export function PlatformSecurityEvents() {
  const [rows, setRows] = useState<PlatformSecurityEvent[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ eventKey: '', severity: '', from: '', to: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiRequest<Paginated<PlatformSecurityEvent>>(
        `/platform/security-events${platformQuery({ ...filters, page })}`,
      );
      setRows(response.data);
      setTotalRows(response.pagination.totalRows);
    } catch {
      setError('Security events could not be loaded.');
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
      title="Security events"
      description="Across every tenant, plus events with no tenant at all."
    >
      <form className="rb-platform__filters" onSubmit={search}>
        <label>
          Event key
          <input
            value={filters.eventKey}
            placeholder="auth.login_failed"
            onChange={(event) => setFilters({ ...filters, eventKey: event.target.value })}
          />
        </label>
        <label>
          Severity
          <select
            value={filters.severity}
            onChange={(event) => setFilters({ ...filters, severity: event.target.value })}
          >
            <option value="">Any</option>
            <option value="INFO">Info</option>
            <option value="WARN">Warn</option>
            <option value="ERROR">Error</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </label>
        <button type="submit">Apply</button>
      </form>

      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="rb-platform__muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rb-platform__muted">No events match these filters.</p>
      ) : (
        <div className="rb-platform__table-wrap">
          <table className="rb-platform__table">
            <caption className="rb-visually-hidden">Security events</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Severity</th>
                <th scope="col">User</th>
                <th scope="col">Organization</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.eventKey}</th>
                  <td>
                    <span
                      className={`rb-platform__pill${row.severity === 'INFO' ? '' : ' is-warn'}`}
                    >
                      {row.severity.toLowerCase()}
                    </span>
                  </td>
                  <td>{row.userEmail ?? '—'}</td>
                  <td>
                    {row.organizationId ? (
                      <Link href={`/platform/organizations/${row.organizationId}`}>
                        {row.organizationName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{new Date(row.occurredAt).toLocaleString()}</td>
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

export function PlatformAudit() {
  const [rows, setRows] = useState<PlatformAuditEvent[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<Paginated<PlatformAuditEvent>>(`/platform/audit${platformQuery({ page })}`)
      .then((response) => {
        setRows(response.data);
        setTotalRows(response.pagination.totalRows);
      })
      .catch(() => setError('The platform audit log could not be loaded.'));
  }, [page]);

  return (
    <PlatformPage
      title="Platform audit"
      description="Every mutating action taken in this console. Kept separately from tenant audit logs, because most of these actions are cross-tenant and none of them were taken by the tenant."
    >
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="rb-platform__muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rb-platform__muted">No platform actions recorded yet.</p>
      ) : (
        <div className="rb-platform__table-wrap">
          <table className="rb-platform__table">
            <caption className="rb-visually-hidden">Platform audit events</caption>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Reason</th>
                <th scope="col">Administrator</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.eventKey}</th>
                  <td>
                    {row.targetType}
                    {row.organizationId ? (
                      <>
                        {' · '}
                        <Link href={`/platform/organizations/${row.organizationId}`}>tenant</Link>
                      </>
                    ) : null}
                  </td>
                  <td>{row.reason ?? '—'}</td>
                  <td>
                    {row.actorEmail}
                    <small>{row.actorRole.toLowerCase()}</small>
                  </td>
                  <td>{new Date(row.occurredAt).toLocaleString()}</td>
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
