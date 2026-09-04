'use client';

import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  StatusBadge,
  Textarea,
  type DataTableColumn,
} from '@retailbooks/ui';
import { AlarmClock, Pencil } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type ReminderPolicy = {
  id: string;
  name: string;
  offsets: number[];
  subject: string;
  bodyTemplate: string;
  active: boolean;
};

export function RemindersPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'automation.schedules.view');
  const canManage = hasPermission(organization, 'automation.schedules.manage');

  const [policies, setPolicies] = useState<ReminderPolicy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [offsetsText, setOffsetsText] = useState('-3, 0, 7');
  const [subject, setSubject] = useState('Invoice {{invoiceNumber}} — {{customerName}}');
  const [bodyTemplate, setBodyTemplate] = useState(
    'Hi {{customerName}}, invoice {{invoiceNumber}} for {{balanceMinor}} is due {{dueDate}}.',
  );

  function resetForm() {
    setEditingPolicyId(null);
    setName('');
    setOffsetsText('-3, 0, 7');
    setSubject('Invoice {{invoiceNumber}} — {{customerName}}');
    setBodyTemplate(
      'Hi {{customerName}}, invoice {{invoiceNumber}} for {{balanceMinor}} is due {{dueDate}}.',
    );
  }

  function startEditing(policy: ReminderPolicy) {
    setEditingPolicyId(policy.id);
    setName(policy.name);
    setOffsetsText(policy.offsets.join(', '));
    setSubject(policy.subject);
    setBodyTemplate(policy.bodyTemplate);
  }

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<{ data: ReminderPolicy[] }>(
        `/organizations/${organizationId}/automation/reminder-policies`,
      );
      setPolicies(response.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Reminder policies could not be loaded.'));
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitPolicy() {
    if (!organizationId || !name.trim()) return;
    const offsets = offsetsText
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value));
    if (!offsets.length) {
      setError('Add at least one whole-day offset, e.g. -3, 0, 7.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        offsets,
        subject: subject.trim(),
        bodyTemplate,
      });
      if (editingPolicyId) {
        await apiRequest(
          `/organizations/${organizationId}/automation/reminder-policies/${editingPolicyId}`,
          {
            method: 'PATCH',
            body,
          },
        );
        setNotice('Reminder policy updated.');
      } else {
        await apiRequest(`/organizations/${organizationId}/automation/reminder-policies`, {
          method: 'POST',
          body,
        });
        setNotice('Reminder policy created.');
      }
      resetForm();
      await load();
    } catch (caught) {
      setError(
        message(
          caught,
          editingPolicyId
            ? 'The reminder policy could not be updated.'
            : 'The reminder policy could not be created.',
        ),
      );
    } finally {
      setCreating(false);
    }
  }

  async function setActive(policy: ReminderPolicy, active: boolean) {
    if (!organizationId) return;
    setBusyId(policy.id);
    setError(null);
    try {
      await apiRequest(
        `/organizations/${organizationId}/automation/reminder-policies/${policy.id}/active`,
        {
          method: 'PATCH',
          body: JSON.stringify({ active }),
        },
      );
      setNotice(active ? 'Reminder policy activated.' : 'Reminder policy deactivated.');
      await load();
    } catch (caught) {
      setError(message(caught, 'The reminder policy could not be updated.'));
    } finally {
      setBusyId(null);
    }
  }

  if (!workspace.loading && organization && !canView) {
    return <ForbiddenState description="Ask for automation access to review due-date reminders." />;
  }

  const columns: readonly DataTableColumn<ReminderPolicy>[] = [
    { key: 'name', header: 'Name', cell: (policy) => <strong>{policy.name}</strong> },
    {
      key: 'offsets',
      header: 'Sends',
      cell: (policy) => policy.offsets.map((offset) => offsetLabel(offset)).join(', '),
    },
    { key: 'subject', header: 'Subject', cell: (policy) => policy.subject, hideBelow: 'desktop' },
    {
      key: 'status',
      header: 'Status',
      cell: (policy) => <StatusBadge status={policy.active ? 'active' : 'inactive'} />,
    },
    {
      key: 'toggle',
      header: '',
      cell: (policy) =>
        canManage ? (
          <div className="rb-ledger-row-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => startEditing(policy)}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busyId === policy.id}
              onClick={() => void setActive(policy, !policy.active)}
            >
              {policy.active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Invoice reminders"
        description="Send a due-date reminder email before, on, or after an invoice is due. Stops automatically once the invoice is paid or void."
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {canManage ? (
          <Card className="rb-ledger-form-card">
            <h2>{editingPolicyId ? 'Edit reminder policy' : 'New reminder policy'}</h2>
            <div className="rb-field">
              <Label htmlFor="reminder-name">Name</Label>
              <Input
                id="reminder-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="reminder-offsets">
                Days relative to the due date (negative = before, 0 = on the day, positive =
                overdue)
              </Label>
              <Input
                id="reminder-offsets"
                value={offsetsText}
                onChange={(event) => setOffsetsText(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="reminder-subject">
                Email subject (use {'{{invoiceNumber}}'}, {'{{customerName}}'}, {'{{dueDate}}'},{' '}
                {'{{balanceMinor}}'})
              </Label>
              <Input
                id="reminder-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="reminder-body">Email body</Label>
              <Textarea
                id="reminder-body"
                rows={3}
                value={bodyTemplate}
                onChange={(event) => setBodyTemplate(event.target.value)}
              />
            </div>
            <div className="rb-ledger-row-actions">
              <Button
                type="button"
                loading={creating}
                disabled={!name.trim()}
                onClick={() => void submitPolicy()}
              >
                {editingPolicyId ? 'Save changes' : 'Create policy'}
              </Button>
              {editingPolicyId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </Card>
        ) : null}

        {policies === null ? <Skeleton /> : null}
        {policies && policies.length === 0 ? (
          <EmptyState
            icon={AlarmClock}
            title="No reminder policies yet"
            description="Create one above to start sending due-date reminders."
          />
        ) : null}
        {policies && policies.length > 0 ? (
          <DataTable caption="Reminder policies" columns={columns} rows={policies} />
        ) : null}
      </div>
    </>
  );
}

function offsetLabel(offset: number): string {
  if (offset === 0) return 'on due date';
  return offset < 0 ? `${Math.abs(offset)}d before` : `${offset}d after`;
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
