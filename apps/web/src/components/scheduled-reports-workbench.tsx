'use client';

import type { OrganizationMember, SavedReport } from '@retailbooks/contracts';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@retailbooks/ui';
import { CalendarClock, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

const CADENCES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'] as const;
const FORMATS = ['csv', 'xlsx', 'pdf'] as const;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type ScheduledReport = {
  id: string;
  name: string;
  format: 'csv' | 'xlsx' | 'pdf';
  recipientUserIds: string[];
  active: boolean;
  savedReport: { id: string; name: string; reportKey: string };
  scheduledJob: {
    status: string;
    nextRunAt: string;
    lastRunAt: string | null;
    schedule: {
      cadence: (typeof CADENCES)[number];
      localTime: string;
      weekday?: number;
      dayOfMonth?: number;
      endDate?: string;
    };
  };
};

export function ScheduledReportsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'automation.schedules.view');
  const canManage = hasPermission(organization, 'automation.schedules.manage');

  const [schedules, setSchedules] = useState<ScheduledReport[] | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [savedReportId, setSavedReportId] = useState('');
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<(typeof FORMATS)[number]>('csv');
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]>('MONTHLY');
  const [localTime, setLocalTime] = useState('08:00');
  const [weekday, setWeekday] = useState('1');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [endDate, setEndDate] = useState('');

  function resetForm() {
    setEditingScheduleId(null);
    setName('');
    setSavedReportId('');
    setRecipients(new Set());
    setFormat('csv');
    setCadence('MONTHLY');
    setLocalTime('08:00');
    setWeekday('1');
    setDayOfMonth('1');
    setEndDate('');
  }

  function startEditing(schedule: ScheduledReport) {
    setEditingScheduleId(schedule.id);
    setName(schedule.name);
    setSavedReportId(schedule.savedReport.id);
    setRecipients(new Set(schedule.recipientUserIds));
    setFormat(schedule.format);
    setCadence(schedule.scheduledJob.schedule.cadence);
    setLocalTime(schedule.scheduledJob.schedule.localTime);
    setWeekday(String(schedule.scheduledJob.schedule.weekday ?? 1));
    setDayOfMonth(String(schedule.scheduledJob.schedule.dayOfMonth ?? 1));
    setEndDate(schedule.scheduledJob.schedule.endDate ?? '');
  }

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [scheduleResponse, savedResponse, memberResponse] = await Promise.all([
        apiRequest<{ data: ScheduledReport[] }>(
          `/organizations/${organizationId}/reports/scheduled`,
        ),
        apiRequest<{ data: SavedReport[] }>(`/organizations/${organizationId}/reports/saved`),
        apiRequest<{ data: OrganizationMember[] }>(`/organizations/${organizationId}/members`),
      ]);
      setSchedules(scheduleResponse.data);
      setSavedReports(savedResponse.data);
      setMembers(memberResponse.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Scheduled reports could not be loaded.'));
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitSchedule() {
    if (!organizationId || !name.trim() || !savedReportId || recipients.size === 0) return;
    setCreating(true);
    setError(null);
    try {
      const schedule = {
        cadence,
        localTime,
        options: {
          weekday: cadence === 'WEEKLY' ? Number(weekday) : undefined,
          dayOfMonth: cadence !== 'DAILY' && cadence !== 'WEEKLY' ? Number(dayOfMonth) : undefined,
          endDate: endDate || undefined,
        },
      };
      if (editingScheduleId) {
        await apiRequest(
          `/organizations/${organizationId}/reports/scheduled/${editingScheduleId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: name.trim(),
              recipientUserIds: [...recipients],
              format,
              schedule,
            }),
          },
        );
        setNotice('Scheduled report updated.');
      } else {
        await apiRequest(`/organizations/${organizationId}/reports/scheduled`, {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            savedReportId,
            recipientUserIds: [...recipients],
            format,
            schedule,
          }),
        });
        setNotice('Scheduled report created.');
      }
      resetForm();
      await load();
    } catch (caught) {
      setError(
        message(
          caught,
          editingScheduleId
            ? 'The scheduled report could not be updated.'
            : 'The scheduled report could not be created.',
        ),
      );
    } finally {
      setCreating(false);
    }
  }

  async function setActive(schedule: ScheduledReport, active: boolean) {
    if (!organizationId) return;
    setBusyId(schedule.id);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/reports/scheduled/${schedule.id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      setNotice(active ? 'Schedule activated.' : 'Schedule deactivated.');
      await load();
    } catch (caught) {
      setError(message(caught, 'The schedule could not be updated.'));
    } finally {
      setBusyId(null);
    }
  }

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask for automation access to review scheduled report delivery." />
    );
  }

  const columns: readonly DataTableColumn<ScheduledReport>[] = [
    { key: 'name', header: 'Name', cell: (schedule) => <strong>{schedule.name}</strong> },
    { key: 'report', header: 'Report', cell: (schedule) => schedule.savedReport.name },
    { key: 'format', header: 'Format', cell: (schedule) => schedule.format.toUpperCase() },
    {
      key: 'recipients',
      header: 'Recipients',
      cell: (schedule) => `${schedule.recipientUserIds.length}`,
    },
    {
      key: 'next',
      header: 'Next run',
      cell: (schedule) => formatDate(schedule.scheduledJob.nextRunAt),
    },
    {
      key: 'last',
      header: 'Last run',
      cell: (schedule) =>
        schedule.scheduledJob.lastRunAt ? formatDate(schedule.scheduledJob.lastRunAt) : 'Never',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (schedule) => <StatusBadge status={schedule.active ? 'active' : 'inactive'} />,
    },
    {
      key: 'toggle',
      header: '',
      cell: (schedule) =>
        canManage ? (
          <div className="rb-ledger-row-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => startEditing(schedule)}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busyId === schedule.id}
              onClick={() => void setActive(schedule, !schedule.active)}
            >
              {schedule.active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Scheduled reports"
        description="Deliver a saved report by email on a recurring cadence."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports/saved">Saved reports</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {canManage ? (
          <Card className="rb-ledger-form-card">
            <h2>{editingScheduleId ? 'Edit schedule' : 'New schedule'}</h2>
            <div className="rb-field">
              <Label htmlFor="schedule-name">Name</Label>
              <Input
                id="schedule-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="schedule-report">Saved report</Label>
              <Select
                id="schedule-report"
                value={savedReportId}
                disabled={Boolean(editingScheduleId)}
                onChange={(event) => setSavedReportId(event.target.value)}
              >
                <option value="">Choose a saved report</option>
                {savedReports.map((report) => (
                  <option key={report.id} value={report.id}>
                    {report.name}
                  </option>
                ))}
              </Select>
              {editingScheduleId ? (
                <p>The saved report a schedule points at cannot be changed after creation.</p>
              ) : null}
            </div>
            <div className="rb-field">
              <Label>Recipients (active members)</Label>
              <ul className="rb-preference-list">
                {members.map((member) => (
                  <li key={member.userId} className="rb-checkbox-field">
                    <input
                      type="checkbox"
                      checked={recipients.has(member.userId)}
                      onChange={(event) =>
                        setRecipients((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(member.userId);
                          else next.delete(member.userId);
                          return next;
                        })
                      }
                    />
                    {member.displayName}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rb-inline-fields">
              <div className="rb-field">
                <Label htmlFor="schedule-format">Format</Label>
                <Select
                  id="schedule-format"
                  value={format}
                  onChange={(event) => setFormat(event.target.value as (typeof FORMATS)[number])}
                >
                  {FORMATS.map((value) => (
                    <option key={value} value={value}>
                      {value.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="schedule-cadence">Cadence</Label>
                <Select
                  id="schedule-cadence"
                  value={cadence}
                  onChange={(event) => setCadence(event.target.value as (typeof CADENCES)[number])}
                >
                  {CADENCES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="rb-field">
                <Label htmlFor="schedule-time">Local time</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={localTime}
                  onChange={(event) => setLocalTime(event.target.value)}
                />
              </div>
              {cadence === 'WEEKLY' ? (
                <div className="rb-field">
                  <Label htmlFor="schedule-weekday">Day of week</Label>
                  <Select
                    id="schedule-weekday"
                    value={weekday}
                    onChange={(event) => setWeekday(event.target.value)}
                  >
                    {WEEKDAYS.map((label, index) => (
                      <option key={label} value={index}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {cadence !== 'DAILY' && cadence !== 'WEEKLY' ? (
                <div className="rb-field">
                  <Label htmlFor="schedule-day-of-month">Day of month</Label>
                  <Input
                    id="schedule-day-of-month"
                    type="number"
                    min={1}
                    max={31}
                    value={dayOfMonth}
                    onChange={(event) => setDayOfMonth(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="rb-field">
                <Label htmlFor="schedule-end-date">End date (optional)</Label>
                <Input
                  id="schedule-end-date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
            <div className="rb-ledger-row-actions">
              <Button
                type="button"
                loading={creating}
                disabled={!name.trim() || !savedReportId || recipients.size === 0}
                onClick={() => void submitSchedule()}
              >
                {editingScheduleId ? 'Save changes' : 'Create schedule'}
              </Button>
              {editingScheduleId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </Card>
        ) : null}

        {schedules === null ? <Skeleton /> : null}
        {schedules && schedules.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No scheduled reports yet"
            description="Create one above to deliver a saved report on a cadence."
          />
        ) : null}
        {schedules && schedules.length > 0 ? (
          <DataTable caption="Scheduled reports" columns={columns} rows={schedules} />
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
