'use client';

import type { Notification } from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  type DataTableColumn,
} from '@retailbooks/ui';
import { Bell, BellOff, CheckCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type NotificationPreference = {
  id: string;
  eventKey: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
};

export function NotificationsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'notifications.view');
  const canManage = hasPermission(organization, 'notifications.manage');

  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [newEventKey, setNewEventKey] = useState('');
  const [newInApp, setNewInApp] = useState(true);
  const [newEmail, setNewEmail] = useState(true);
  const [savingPreference, setSavingPreference] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId || !canView) return;
    try {
      const response = await apiRequest<{ data: Notification[] }>(
        `/organizations/${organizationId}/notifications${unreadOnly ? '?unreadOnly=true' : ''}`,
      );
      setNotifications(response.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Notifications could not be loaded.'));
    }
  }, [canView, organizationId, unreadOnly]);

  const loadPreferences = useCallback(async () => {
    if (!organizationId || !canView) return;
    try {
      const response = await apiRequest<{ data: NotificationPreference[] }>(
        `/organizations/${organizationId}/notifications/preferences`,
      );
      setPreferences(response.data);
    } catch {
      setPreferences([]);
    }
  }, [canView, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  async function markRead(notification: Notification) {
    if (!organizationId || notification.status === 'READ') return;
    setBusyId(notification.id);
    try {
      await apiRequest(`/organizations/${organizationId}/notifications/${notification.id}/read`, {
        method: 'POST',
      });
      await load();
    } catch (caught) {
      setError(message(caught, 'This notification could not be marked read.'));
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    if (!organizationId) return;
    setMarkingAll(true);
    try {
      await apiRequest(`/organizations/${organizationId}/notifications/read-all`, {
        method: 'POST',
      });
      setNotice('All notifications marked read.');
      await load();
    } catch (caught) {
      setError(message(caught, 'Notifications could not be marked read.'));
    } finally {
      setMarkingAll(false);
    }
  }

  async function savePreference(eventKey: string, inAppEnabled: boolean, emailEnabled: boolean) {
    if (!organizationId) return;
    setSavingPreference(true);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/notifications/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ eventKey, inAppEnabled, emailEnabled }),
      });
      setNotice(`Preference for "${eventKey}" saved.`);
      setNewEventKey('');
      await loadPreferences();
    } catch (caught) {
      setError(message(caught, 'The preference could not be saved.'));
    } finally {
      setSavingPreference(false);
    }
  }

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask for notifications access to see what's been sent to you." />
    );
  }

  const columns: readonly DataTableColumn<Notification>[] = [
    {
      key: 'status',
      header: '',
      width: '2.5rem',
      cell: (notification) =>
        notification.status === 'UNREAD' ? <Badge tone="info">New</Badge> : null,
    },
    {
      key: 'title',
      header: 'Notification',
      cell: (notification) =>
        notification.href ? (
          <Link href={notification.href} onClick={() => void markRead(notification)}>
            {notification.title}
          </Link>
        ) : (
          notification.title
        ),
    },
    {
      key: 'body',
      header: 'Detail',
      cell: (notification) => notification.body ?? '',
      hideBelow: 'desktop',
    },
    { key: 'when', header: 'When', cell: (notification) => formatDate(notification.createdAt) },
    {
      key: 'actions',
      header: '',
      cell: (notification) =>
        notification.status === 'UNREAD' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busyId === notification.id}
            onClick={() => void markRead(notification)}
          >
            Mark read
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What automation rules, approvals, and reminders have sent you."
        actions={
          <div className="rb-ledger-row-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setUnreadOnly((current) => !current)}
            >
              {unreadOnly ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
              {unreadOnly ? 'Show all' : 'Unread only'}
            </Button>
            <Button type="button" size="sm" loading={markingAll} onClick={() => void markAllRead()}>
              <CheckCheck aria-hidden="true" /> Mark all read
            </Button>
          </div>
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {notifications === null ? <Skeleton /> : null}
        {notifications && notifications.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="You're all caught up." />
        ) : null}
        {notifications && notifications.length > 0 ? (
          <DataTable caption="Notifications" columns={columns} rows={notifications} />
        ) : null}

        {canManage ? (
          <Card className="rb-ledger-form-card">
            <h2>Delivery preferences</h2>
            <p>
              By default every event sends both an in-app and an email notification. Add an
              exception below to turn either off for a specific event key.
            </p>
            {preferences && preferences.length > 0 ? (
              <ul className="rb-preference-list">
                {preferences.map((preference) => (
                  <li key={preference.id} className="rb-inline-fields">
                    <code>{preference.eventKey}</code>
                    <label className="rb-checkbox-field">
                      <input
                        type="checkbox"
                        checked={preference.inAppEnabled}
                        onChange={(event) =>
                          void savePreference(
                            preference.eventKey,
                            event.target.checked,
                            preference.emailEnabled,
                          )
                        }
                      />
                      In-app
                    </label>
                    <label className="rb-checkbox-field">
                      <input
                        type="checkbox"
                        checked={preference.emailEnabled}
                        onChange={(event) =>
                          void savePreference(
                            preference.eventKey,
                            preference.inAppEnabled,
                            event.target.checked,
                          )
                        }
                      />
                      Email
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="rb-inline-fields">
              <div className="rb-field">
                <Label htmlFor="new-preference-key">Event key</Label>
                <Input
                  id="new-preference-key"
                  value={newEventKey}
                  onChange={(event) => setNewEventKey(event.target.value)}
                  placeholder="e.g. automation.approval_submitted"
                />
              </div>
              <label className="rb-checkbox-field">
                <input
                  type="checkbox"
                  checked={newInApp}
                  onChange={(event) => setNewInApp(event.target.checked)}
                />
                In-app
              </label>
              <label className="rb-checkbox-field">
                <input
                  type="checkbox"
                  checked={newEmail}
                  onChange={(event) => setNewEmail(event.target.checked)}
                />
                Email
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={savingPreference}
                disabled={!newEventKey.trim()}
                onClick={() => void savePreference(newEventKey.trim(), newInApp, newEmail)}
              >
                <Plus aria-hidden="true" /> Add
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof ApiError || caught instanceof Error ? caught.message : fallback;
}

function Messages({ error, notice }: { error?: string | null; notice?: string | null }) {
  return (
    <>
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rb-auth-success" role="status">
          {notice}
        </div>
      ) : null}
    </>
  );
}
