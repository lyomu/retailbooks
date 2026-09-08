'use client';

import type { PlatformAnalytics } from '@retailbooks/contracts';
import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { PlatformPage } from './platform-shell';

/**
 * Platform overview: activation, adoption, retention, and distribution.
 *
 * Every figure is a count of organizations or a percentage of them. Nothing here is money — the
 * API does not return any, by design, so this screen could not display revenue even if asked.
 */
export function PlatformOverview() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<{ data: PlatformAnalytics }>('/platform/analytics')
      .then((response) => setAnalytics(response.data))
      .catch(() => setError('Analytics could not be loaded.'));
  }, []);

  if (error) {
    return (
      <PlatformPage title="Overview">
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      </PlatformPage>
    );
  }
  if (!analytics) {
    return (
      <PlatformPage title="Overview">
        <p className="rb-platform__muted">Loading platform analytics…</p>
      </PlatformPage>
    );
  }

  return (
    <PlatformPage
      title="Overview"
      description={`Platform-wide adoption as at ${new Date(analytics.observedAt).toLocaleString()}.`}
    >
      <section className="rb-platform__stats" aria-label="Organizations">
        <Stat label="Organizations" value={analytics.organizations.total} />
        <Stat label="Active" value={analytics.organizations.active} />
        <Stat label="Suspended" value={analytics.organizations.suspended} tone="warn" />
        <Stat label="Still in setup" value={analytics.organizations.draft} />
        <Stat label="New in 30 days" value={analytics.organizations.createdLast30Days} />
        <Stat label="Users" value={analytics.users.total} />
      </section>

      <div className="rb-platform__grid">
        <section className="rb-platform__card" aria-label="Activation">
          <h2>Activation</h2>
          <dl>
            <Row
              label="Finished onboarding"
              value={`${analytics.activation.onboardingCompleted} (${analytics.activation.onboardingCompletedRate}%)`}
            />
            <Row
              label="Issued a first invoice"
              value={`${analytics.activation.reachedFirstInvoice} (${analytics.activation.reachedFirstInvoiceRate}%)`}
            />
          </dl>
        </section>

        <section className="rb-platform__card" aria-label="Retention">
          <h2>Retention</h2>
          <dl>
            <Row
              label="Active in 30 days"
              value={`${analytics.retention.activeLast30Days} (${analytics.retention.activeLast30DaysRate}% of active)`}
            />
            <Row label="Active in 90 days" value={analytics.retention.activeLast90Days} />
          </dl>
          <p className="rb-platform__muted">
            Measured from audit activity, which every state change writes.
          </p>
        </section>

        <section className="rb-platform__card" aria-label="Module adoption">
          <h2>Module adoption</h2>
          <dl>
            <Row label="Invoicing" value={analytics.adoption.invoicing} />
            <Row label="Banking" value={analytics.adoption.banking} />
            <Row label="Inventory" value={analytics.adoption.inventory} />
            <Row label="Projects" value={analytics.adoption.projects} />
            <Row label="Portals" value={analytics.adoption.portals} />
            <Row label="Automation" value={analytics.adoption.automation} />
          </dl>
        </section>

        <section className="rb-platform__card" aria-label="Plans">
          <h2>By plan</h2>
          <dl>
            {analytics.distribution.byPlan.length === 0 ? (
              <p className="rb-platform__muted">No subscriptions yet.</p>
            ) : (
              analytics.distribution.byPlan.map((row) => (
                <Row key={row.planId} label={row.planName} value={row.organizations} />
              ))
            )}
          </dl>
        </section>

        <section className="rb-platform__card" aria-label="Countries">
          <h2>By country</h2>
          <dl>
            {analytics.distribution.byCountry.slice(0, 10).map((row) => (
              <Row key={row.countryCode} label={row.countryCode} value={row.organizations} />
            ))}
          </dl>
        </section>
      </div>
    </PlatformPage>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className={`rb-platform__stat${tone === 'warn' ? ' is-warn' : ''}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rb-platform__row">
      <dt>{label}</dt>
      <dd>{typeof value === 'number' ? value.toLocaleString() : value}</dd>
    </div>
  );
}
