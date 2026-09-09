'use client';

import type { FeatureFlag, PlatformPlan } from '@retailbooks/contracts';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { platformRoleAtLeast, usePlatformSession } from '../lib/platform';
import { PlatformPage } from './platform-shell';

export function PlatformPlans() {
  const { session } = usePlatformSession();
  const [plans, setPlans] = useState<PlatformPlan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: PlatformPlan[] }>('/platform/plans');
      setPlans(response.data);
    } catch {
      setError('Plans could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(path: string, body: unknown, method: 'POST' | 'PATCH', success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(path, { method, body: JSON.stringify(body) });
      setNotice(success);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlatformPage
      title="Plans and entitlements"
      description="What each tier allows. Entitlements are resolved per organization from the plan it is on."
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

      {plans === null ? (
        <p className="rb-platform__muted">Loading plans…</p>
      ) : (
        <div className="rb-platform__grid">
          {plans.map((plan) => (
            <section key={plan.id} className="rb-platform__card" aria-label={plan.name}>
              <div className="rb-platform__card-head">
                <h2>
                  {plan.name}
                  {plan.isDefault ? <span className="rb-platform__pill is-ok">default</span> : null}
                </h2>
                <span className="rb-platform__pill">{plan.status.toLowerCase()}</span>
              </div>
              <p className="rb-platform__muted">{plan.description ?? 'No description.'}</p>
              <dl>
                <div className="rb-platform__row">
                  <dt>Key</dt>
                  <dd>{plan.key}</dd>
                </div>
                <div className="rb-platform__row">
                  <dt>Price</dt>
                  <dd>
                    {plan.currency} {(Number(plan.priceMinor) / 100).toFixed(2)} /{' '}
                    {plan.billingInterval.toLowerCase()}
                  </dd>
                </div>
                <div className="rb-platform__row">
                  <dt>Trial</dt>
                  <dd>{plan.trialDays > 0 ? `${plan.trialDays} days` : 'None'}</dd>
                </div>
                <div className="rb-platform__row">
                  <dt>Organizations</dt>
                  <dd>{plan.subscriberCount}</dd>
                </div>
              </dl>

              <h3>Entitlements</h3>
              {plan.entitlements.length === 0 ? (
                <p className="rb-platform__muted">None yet.</p>
              ) : (
                <ul className="rb-platform__list">
                  {plan.entitlements.map((entitlement) => (
                    <li key={entitlement.key}>
                      <span>{entitlement.key}</span>
                      <span>
                        {!entitlement.enabled
                          ? 'off'
                          : entitlement.limitValue === null
                            ? 'unlimited'
                            : entitlement.limitValue}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {canManage ? (
                <EntitlementEditor
                  busy={busy}
                  onSave={(input) =>
                    void mutate(
                      `/platform/plans/${plan.id}/entitlements`,
                      input,
                      'POST',
                      `Entitlement ${input.key} saved.`,
                    )
                  }
                />
              ) : null}

              {canManage && !plan.isDefault && plan.status === 'ACTIVE' ? (
                <div className="rb-platform__actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        `/platform/plans/${plan.id}`,
                        { isDefault: true },
                        'PATCH',
                        `${plan.name} is now the default plan.`,
                      )
                    }
                  >
                    Make default
                  </button>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </PlatformPage>
  );
}

function EntitlementEditor({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (input: { key: string; enabled: boolean; limitValue?: number }) => void;
}) {
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState('');

  return (
    <form
      className="rb-platform__inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!key.trim()) return;
        // An empty limit means unlimited, which the API represents by omitting the field.
        onSave({
          key: key.trim().toLowerCase(),
          enabled,
          ...(limit.trim() ? { limitValue: Number(limit) } : {}),
        });
        setKey('');
        setLimit('');
      }}
    >
      <label>
        Entitlement key
        <input
          value={key}
          placeholder="members.max"
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <label>
        Limit
        <input
          value={limit}
          inputMode="numeric"
          placeholder="blank = unlimited"
          onChange={(event) => setLimit(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      <label className="rb-platform__check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enabled
      </label>
      <button type="submit" disabled={busy || !key.trim()}>
        Save entitlement
      </button>
    </form>
  );
}

export function PlatformFeatureFlags() {
  const { session } = usePlatformSession();
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: FeatureFlag[] }>('/platform/feature-flags');
      setFlags(response.data);
    } catch {
      setError('Feature flags could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
    success: string,
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      setNotice(success);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlatformPage
      title="Feature flags"
      description="Targeting resolves most-specific-first: organization, then plan, then country, then global, then the flag's own default."
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

      {canManage ? (
        <FlagCreator
          busy={busy}
          onCreate={(body) =>
            void mutate('/platform/feature-flags', 'POST', body, 'Feature flag created.')
          }
        />
      ) : null}

      {flags === null ? (
        <p className="rb-platform__muted">Loading feature flags…</p>
      ) : flags.length === 0 ? (
        <p className="rb-platform__muted">No feature flags yet.</p>
      ) : (
        flags.map((flag) => (
          <section key={flag.id} className="rb-platform__card" aria-label={flag.key}>
            <div className="rb-platform__card-head">
              <h2>{flag.name}</h2>
              <span className="rb-platform__pill">{flag.status.toLowerCase()}</span>
            </div>
            <p className="rb-platform__muted">
              <code>{flag.key}</code> — {flag.description ?? 'No description.'} Default:{' '}
              <strong>{flag.defaultEnabled ? 'on' : 'off'}</strong>.
            </p>

            {flag.rules.length === 0 ? (
              <p className="rb-platform__muted">
                No targeting rules — every organization gets the default.
              </p>
            ) : (
              <ul className="rb-platform__list">
                {flag.rules.map((rule) => (
                  <li key={rule.id}>
                    <span>
                      {rule.scope.toLowerCase()}
                      {rule.countryCode ? ` · ${rule.countryCode}` : ''}
                      {rule.planName ? ` · ${rule.planName}` : ''}
                      {rule.organizationName ? ` · ${rule.organizationName}` : ''}
                    </span>
                    <span>
                      {rule.enabled ? 'on' : 'off'}
                      {canManage ? (
                        <button
                          type="button"
                          className="rb-platform__link"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/platform/feature-flags/rules/${rule.id}`,
                              'DELETE',
                              undefined,
                              'Rule removed.',
                            )
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {canManage ? (
              <>
                <FlagRuleEditor
                  busy={busy}
                  onSave={(body) =>
                    void mutate(
                      `/platform/feature-flags/${flag.id}/rules`,
                      'POST',
                      body,
                      'Targeting rule saved.',
                    )
                  }
                />
                <div className="rb-platform__actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        `/platform/feature-flags/${flag.id}`,
                        'PATCH',
                        { defaultEnabled: !flag.defaultEnabled },
                        `Default is now ${flag.defaultEnabled ? 'off' : 'on'}.`,
                      )
                    }
                  >
                    Turn default {flag.defaultEnabled ? 'off' : 'on'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        `/platform/feature-flags/${flag.id}`,
                        'PATCH',
                        { status: flag.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' },
                        flag.status === 'ACTIVE' ? 'Flag archived.' : 'Flag restored.',
                      )
                    }
                  >
                    {flag.status === 'ACTIVE' ? 'Archive' : 'Restore'}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ))
      )}
    </PlatformPage>
  );
}

function FlagCreator({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (body: { key: string; name: string; defaultEnabled: boolean }) => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [defaultEnabled, setDefaultEnabled] = useState(false);

  return (
    <form
      className="rb-platform__inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!key.trim() || !name.trim()) return;
        onCreate({ key: key.trim().toLowerCase(), name: name.trim(), defaultEnabled });
        setKey('');
        setName('');
      }}
    >
      <label>
        Key
        <input
          value={key}
          placeholder="inventory.multi_warehouse"
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="rb-platform__check">
        <input
          type="checkbox"
          checked={defaultEnabled}
          onChange={(event) => setDefaultEnabled(event.target.checked)}
        />
        On by default
      </label>
      <button type="submit" disabled={busy || !key.trim() || !name.trim()}>
        Create flag
      </button>
    </form>
  );
}

function FlagRuleEditor({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [scope, setScope] = useState<'GLOBAL' | 'COUNTRY' | 'PLAN' | 'ORGANIZATION'>('GLOBAL');
  const [target, setTarget] = useState('');
  const [enabled, setEnabled] = useState(true);

  const needsTarget = scope !== 'GLOBAL';
  const targetField =
    scope === 'COUNTRY' ? 'countryCode' : scope === 'PLAN' ? 'planId' : 'organizationId';

  return (
    <form
      className="rb-platform__inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (needsTarget && !target.trim()) return;
        onSave({
          scope,
          enabled,
          ...(needsTarget ? { [targetField]: target.trim() } : {}),
        });
        setTarget('');
      }}
    >
      <label>
        Scope
        <select
          value={scope}
          onChange={(event) => {
            setScope(event.target.value as typeof scope);
            setTarget('');
          }}
        >
          <option value="GLOBAL">Global</option>
          <option value="COUNTRY">Country</option>
          <option value="PLAN">Plan</option>
          <option value="ORGANIZATION">Organization</option>
        </select>
      </label>
      {needsTarget ? (
        <label>
          {scope === 'COUNTRY' ? 'Country code' : scope === 'PLAN' ? 'Plan id' : 'Organization id'}
          <input value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
      ) : null}
      <label className="rb-platform__check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enabled
      </label>
      <button type="submit" disabled={busy || (needsTarget && !target.trim())}>
        Save rule
      </button>
    </form>
  );
}
