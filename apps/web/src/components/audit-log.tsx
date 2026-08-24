'use client';

import type { SecurityEvent } from '@retailbooks/contracts';
import {
  Badge,
  Card,
  Button,
  DataTable,
  ForbiddenState,
  Input,
  Label,
  Select,
  Skeleton,
  type DataTableColumn,
} from '@retailbooks/ui';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type AuditLogResponse = { data: { events: SecurityEvent[]; nextCursor: string | null } };

const EVENT_PREFIXES = [
  { value: '', label: 'All activity' },
  { value: 'organization.', label: 'Organization' },
  { value: 'periods.', label: 'Fiscal periods' },
  { value: 'numbering.', label: 'Numbering' },
  { value: 'ledger.', label: 'Ledger' },
  { value: 'tax.', label: 'Tax' },
  { value: 'auth.', label: 'Sign-in' },
];

const EVENT_LABELS: Record<string, string> = {
  'organization.created': 'Organization created',
  'organization.section_updated': 'Organization settings updated',
  'organization.finalized': 'Onboarding finalized',
  'organization.member_updated': 'Member updated',
  'organization.member_removed': 'Member removed',
  'organization.invitation_sent': 'Invitation sent',
  'organization.invitation_revoked': 'Invitation revoked',
  'organization.invitation_accepted': 'Invitation accepted',
  'organization.role_permissions_updated': 'Role permissions updated',
  'periods.fiscal_year_created': 'Fiscal year generated',
  'periods.period_closed': 'Period closed',
  'periods.period_locked': 'Period locked',
  'periods.period_reopened': 'Period reopened',
  'periods.period_unlocked': 'Period unlocked',
  'numbering.journal_config_updated': 'Journal numbering updated',
  'ledger.account_created': 'Account created',
  'ledger.account_updated': 'Account updated',
  'ledger.account_archived': 'Account archived',
  'ledger.journal_posted': 'Journal posted',
  'ledger.journal_reversed': 'Journal reversed',
  'tax.code_created': 'Tax code created',
  'tax.code_updated': 'Tax code updated',
  'tax.code_archived': 'Tax code archived',
  'tax.rate_added': 'Tax rate added',
  'auth.signup': 'Account created',
  'auth.email_verified': 'Email verified',
  'auth.login_failed': 'Sign-in failed',
  'auth.login_succeeded': 'Signed in',
  'auth.password_reset': 'Password reset',
};

export function AuditLog() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'audit.view');

  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [eventKey, setEventKey] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (!organizationId) return null;
      const params = new URLSearchParams();
      if (eventKey) params.set('eventKey', eventKey);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (cursor) params.set('cursor', cursor);
      return apiRequest<AuditLogResponse>(
        `/organizations/${organizationId}/audit-log?${params.toString()}`,
      );
    },
    [eventKey, from, organizationId, to],
  );

  const load = useCallback(async () => {
    if (!organizationId || !canView) return;
    try {
      const response = await fetchPage(null);
      if (!response) return;
      setEvents(response.data.events);
      setNextCursor(response.data.nextCursor);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The audit log could not be loaded.');
    }
  }, [canView, fetchPage, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const response = await fetchPage(nextCursor);
      if (!response) return;
      setEvents((current) => [...(current ?? []), ...response.data.events]);
      setNextCursor(response.data.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'More events could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  }

  if (!canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant audit-log access." />
    );
  }

  const columns: readonly DataTableColumn<SecurityEvent>[] = [
    {
      key: 'event',
      header: 'Event',
      cell: (event) => (
        <div>
          <strong>{EVENT_LABELS[event.eventKey] ?? event.eventKey}</strong>
          <span className="rb-table-secondary">{event.eventKey}</span>
        </div>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (event) => (event.actor ? event.actor.displayName : 'System'),
      hideBelow: 'tablet',
    },
    {
      key: 'occurredAt',
      header: 'When',
      cell: (event) => new Date(event.occurredAt).toLocaleString(),
    },
    {
      key: 'severity',
      header: 'Severity',
      cell: (event) => (
        <Badge tone={event.severity === 'INFO' ? 'neutral' : 'warning'}>{event.severity}</Badge>
      ),
      hideBelow: 'tablet',
    },
  ];

  return (
    <div className="rb-ledger-stack">
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}

      <Card className="rb-ledger-toolbar">
        <div className="rb-field">
          <Label htmlFor="audit-event-key">Activity</Label>
          <Select
            id="audit-event-key"
            value={eventKey}
            onChange={(event) => setEventKey(event.target.value)}
          >
            {EVENT_PREFIXES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="rb-field">
          <Label htmlFor="audit-from">From</Label>
          <Input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="rb-field">
          <Label htmlFor="audit-to">To</Label>
          <Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Card>

      {!events && !error ? (
        <div className="rb-security-loading" aria-label="Loading audit log">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : (
        <>
          <DataTable
            caption="Audit log"
            columns={columns}
            rows={events ?? []}
            emptyTitle="No activity yet"
            emptyDescription="Actions across this organization will appear here as they happen."
          />
          {nextCursor ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadMore()}
              loading={loadingMore}
            >
              <ShieldCheck aria-hidden="true" /> Load more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
