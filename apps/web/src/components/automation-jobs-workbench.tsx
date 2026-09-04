'use client';

import {
  Button,
  DataTable,
  EmptyState,
  ForbiddenState,
  PageHeader,
  Skeleton,
  type DataTableColumn,
} from '@retailbooks/ui';
import { AlertOctagon, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type FailedExecution = {
  id: string;
  occurrenceKey: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  scheduledJob: {
    id: string;
    handler: string;
    sourceType: string;
    sourceId: string;
    status: string;
  };
};

export function AutomationJobsPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'automation.jobs.view');
  const canRetry = hasPermission(organization, 'automation.jobs.retry');

  const [executions, setExecutions] = useState<FailedExecution[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<{ data: FailedExecution[] }>(
        `/organizations/${organizationId}/automation/jobs/failed`,
      );
      setExecutions(response.data);
      setError(null);
    } catch (caught) {
      setError(message(caught, 'Failed jobs could not be loaded.'));
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(execution: FailedExecution) {
    if (!organizationId) return;
    setBusyId(execution.id);
    setError(null);
    try {
      await apiRequest(`/organizations/${organizationId}/automation/jobs/${execution.id}/retry`, {
        method: 'POST',
      });
      setNotice('Queued for retry.');
      await load();
    } catch (caught) {
      setError(message(caught, 'This job could not be retried.'));
    } finally {
      setBusyId(null);
    }
  }

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask for automation access to review background job failures." />
    );
  }

  const columns: readonly DataTableColumn<FailedExecution>[] = [
    {
      key: 'handler',
      header: 'Handler',
      cell: (execution) => <code>{execution.scheduledJob.handler}</code>,
    },
    { key: 'source', header: 'Source', cell: (execution) => execution.scheduledJob.sourceType },
    { key: 'attempts', header: 'Attempts', cell: (execution) => `${execution.attempts}` },
    {
      key: 'failed',
      header: 'Failed at',
      cell: (execution) => (execution.completedAt ? formatDate(execution.completedAt) : '—'),
    },
    {
      key: 'error',
      header: 'Error',
      cell: (execution) => execution.error ?? '—',
      hideBelow: 'desktop',
    },
    {
      key: 'actions',
      header: '',
      cell: (execution) =>
        canRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busyId === execution.id}
            onClick={() => void retry(execution)}
          >
            <RotateCcw aria-hidden="true" /> Retry
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Job failures"
        description="Background automation jobs (scheduled reports, recurring documents, reminders) that failed and are waiting to be retried."
      />
      <div className="rb-ledger-stack">
        <Messages error={error} notice={notice} />
        {executions === null ? <Skeleton /> : null}
        {executions && executions.length === 0 ? (
          <EmptyState
            icon={AlertOctagon}
            title="No failed jobs"
            description="Every scheduled job has run cleanly."
          />
        ) : null}
        {executions && executions.length > 0 ? (
          <DataTable caption="Failed automation jobs" columns={columns} rows={executions} />
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
