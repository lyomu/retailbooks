'use client';

import type {
  OrganizationEntitlements,
  PlatformOrganization,
  PlatformPlan,
  PlatformUsage,
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
import { PlatformPage } from './platform-shell';

type Detail = PlatformOrganization & {
  locale: string;
  timeZone: string;
  suspendedBy: string | null;
  onboardingStep: string;
  onboardingCompletedAt: string | null;
  owner: { id: string; email: string; displayName: string };
  members: Array<{
    userId: string;
    email: string;
    displayName: string;
    userStatus: string;
    roleKey: string;
    roleName: string;
    membershipStatus: string;
  }>;
  usage: PlatformUsage;
  entitlements: OrganizationEntitlements;
};

export function PlatformOrganizations() {
  const [rows, setRows] = useState<PlatformOrganization[] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ query: '', status: '', countryCode: '', planKey: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiRequest<Paginated<PlatformOrganization>>(
        `/platform/organizations${platformQuery({ ...filters, page })}`,
      );
      setRows(response.data);
      setTotalRows(response.pagination.totalRows);
    } catch {
      setError('Organizations could not be loaded.');
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
      title="Organizations"
      description={`${totalRows.toLocaleString()} tenant${totalRows === 1 ? '' : 's'} on this deployment.`}
    >
      <form className="rb-platform__filters" onSubmit={search}>
        <label>
          Search
          <input
            value={filters.query}
            placeholder="Name or slug"
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
            <option value="DRAFT">In setup</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </label>
        <label>
          Country
          <input
            value={filters.countryCode}
            maxLength={2}
            placeholder="KE"
            onChange={(event) =>
              setFilters({ ...filters, countryCode: event.target.value.toUpperCase() })
            }
          />
        </label>
        <label>
          Plan
          <input
            value={filters.planKey}
            placeholder="growth"
            onChange={(event) => setFilters({ ...filters, planKey: event.target.value })}
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
        <p className="rb-platform__muted">Loading organizations…</p>
      ) : rows.length === 0 ? (
        <p className="rb-platform__muted">No organizations match these filters.</p>
      ) : (
        <div className="rb-platform__table-wrap">
          <table className="rb-platform__table">
            <caption className="rb-visually-hidden">Organizations</caption>
            <thead>
              <tr>
                <th scope="col">Organization</th>
                <th scope="col">Status</th>
                <th scope="col">Country</th>
                <th scope="col">Plan</th>
                <th scope="col">Members</th>
                <th scope="col">Owner</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Link href={`/platform/organizations/${row.id}`}>{row.name}</Link>
                    <small>{row.slug}</small>
                  </th>
                  <td>
                    <StatusPill status={row.status} />
                  </td>
                  <td>{row.countryCode}</td>
                  <td>{row.planName ?? '—'}</td>
                  <td>{row.memberCount}</td>
                  <td>{row.ownerEmail}</td>
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

export function PlatformOrganizationDetail({ organizationId }: { organizationId: string }) {
  const { session } = usePlatformSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [reason, setReason] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const canOperate = platformRoleAtLeast(session?.role ?? null, 'OPERATIONS');
  const canManagePlans = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: Detail }>(
        `/platform/organizations/${organizationId}`,
      );
      setDetail(response.data);
    } catch {
      setError('This organization could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
    if (canManagePlans) {
      void apiRequest<{ data: PlatformPlan[] }>('/platform/plans')
        .then((response) => setPlans(response.data))
        .catch(() => setPlans([]));
    }
  }, [load, canManagePlans]);

  async function act(path: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/platform/organizations/${organizationId}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNotice(success);
      setReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <PlatformPage title="Organization">
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      </PlatformPage>
    );
  }
  if (!detail) {
    return (
      <PlatformPage title="Organization">
        <p className="rb-platform__muted">Loading…</p>
      </PlatformPage>
    );
  }

  return (
    <PlatformPage
      title={detail.name}
      description={`${detail.slug} · ${detail.countryCode} · ${detail.baseCurrency}`}
      actions={<StatusPill status={detail.status} />}
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

      {detail.status === 'SUSPENDED' ? (
        <section className="rb-platform__card is-warn" aria-label="Suspension">
          <h2>Suspended</h2>
          <p>
            {detail.suspendedReason ?? 'No reason recorded.'}
            {detail.suspendedAt
              ? ` — ${new Date(detail.suspendedAt).toLocaleString()}`
              : ' — recorded before platform administration existed.'}
            {detail.suspendedBy ? ` by ${detail.suspendedBy}` : ''}
          </p>
          <p className="rb-platform__muted">
            Suspension blocks access only. This tenant&apos;s books are unchanged and reactivation
            restores them exactly as they are.
          </p>
          {canOperate ? (
            <div className="rb-platform__actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act('reactivate', { reason }, 'Organization reactivated.')}
              >
                Reactivate
              </button>
            </div>
          ) : null}
        </section>
      ) : canOperate ? (
        <section className="rb-platform__card" aria-label="Suspend this organization">
          <h2>Suspend</h2>
          <p className="rb-platform__muted">
            Blocks access without changing any data. A reason is required — it is the only durable
            answer to why this tenant was locked out.
          </p>
          <label>
            Reason
            <input
              value={reason}
              minLength={4}
              maxLength={500}
              placeholder="Non-payment, abuse report, customer request…"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="rb-platform__actions">
            <button
              type="button"
              className="is-danger"
              disabled={busy || reason.trim().length < 4}
              onClick={() => void act('suspend', { reason }, 'Organization suspended.')}
            >
              Suspend organization
            </button>
          </div>
        </section>
      ) : null}

      <div className="rb-platform__grid">
        <section className="rb-platform__card" aria-label="Plan">
          <h2>Plan</h2>
          <dl>
            <Row label="Plan" value={detail.entitlements.plan?.name ?? 'None'} />
            <Row label="Subscription" value={detail.entitlements.subscription?.status ?? '—'} />
            <Row
              label="Trial ends"
              value={
                detail.entitlements.subscription?.trialEndsAt
                  ? new Date(detail.entitlements.subscription.trialEndsAt).toLocaleDateString()
                  : '—'
              }
            />
          </dl>
          {canManagePlans ? (
            <>
              <label>
                Move to plan
                <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
                  <option value="">Choose a plan</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rb-platform__actions">
                <button
                  type="button"
                  disabled={busy || !planId}
                  onClick={() => void act('plan', { planId, reason }, 'Plan updated.')}
                >
                  Assign plan
                </button>
              </div>
            </>
          ) : null}
        </section>

        <section className="rb-platform__card" aria-label="Entitlements">
          <h2>Entitlements</h2>
          {detail.entitlements.entitlements.length === 0 ? (
            <p className="rb-platform__muted">This plan carries no entitlements.</p>
          ) : (
            <dl>
              {detail.entitlements.entitlements.map((entitlement) => (
                <Row
                  key={entitlement.key}
                  label={entitlement.key}
                  value={
                    !entitlement.enabled
                      ? 'off'
                      : entitlement.limitValue === null
                        ? 'unlimited'
                        : String(entitlement.limitValue)
                  }
                />
              ))}
            </dl>
          )}
        </section>

        <section className="rb-platform__card" aria-label="Feature flags">
          <h2>Feature flags</h2>
          {detail.entitlements.flags.length === 0 ? (
            <p className="rb-platform__muted">No active feature flags.</p>
          ) : (
            <dl>
              {detail.entitlements.flags.map((flag) => (
                <Row
                  key={flag.key}
                  label={flag.key}
                  value={`${flag.enabled ? 'on' : 'off'} · ${flag.decidedBy.toLowerCase()}`}
                />
              ))}
            </dl>
          )}
        </section>

        <section className="rb-platform__card" aria-label="Usage">
          <h2>Adoption</h2>
          <dl>
            <Row label="Issued invoices" value={detail.usage.issuedInvoices} />
            <Row
              label="First invoice"
              value={
                detail.usage.firstInvoiceAt
                  ? new Date(detail.usage.firstInvoiceAt).toLocaleDateString()
                  : '—'
              }
            />
            <Row label="Bills" value={detail.usage.bills} />
            <Row label="Posted journals" value={detail.usage.postedJournals} />
            <Row label="Reconciliations" value={detail.usage.reconciliations} />
            <Row label="Projects" value={detail.usage.projects} />
            <Row label="Inventory adjustments" value={detail.usage.inventoryAdjustments} />
            <Row label="Portal users" value={detail.usage.portalUsers} />
          </dl>
          <p className="rb-platform__muted">
            Counts and dates only — the console does not read this tenant&apos;s financial data.
          </p>
        </section>
      </div>

      <section className="rb-platform__card" aria-label="Members">
        <h2>Members</h2>
        <div className="rb-platform__table-wrap">
          <table className="rb-platform__table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Account</th>
              </tr>
            </thead>
            <tbody>
              {detail.members.map((member) => (
                <tr key={member.userId}>
                  <th scope="row">
                    <Link href={`/platform/users/${member.userId}`}>{member.displayName}</Link>
                    <small>{member.email}</small>
                  </th>
                  <td>{member.roleName}</td>
                  <td>{member.userStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PlatformPage>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE' ? 'is-ok' : status === 'SUSPENDED' || status === 'CLOSED' ? 'is-warn' : '';
  return <span className={`rb-platform__pill ${tone}`}>{status.replaceAll('_', ' ')}</span>;
}

export function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rb-platform__row">
      <dt>{label}</dt>
      <dd>{typeof value === 'number' ? value.toLocaleString() : value}</dd>
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  totalRows,
  onChange,
}: {
  page: number;
  pageSize: number;
  totalRows: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="rb-platform__pager" aria-label="Pagination">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </nav>
  );
}
