'use client';

import type { FiscalPeriod, FiscalYear } from '@retailbooks/contracts';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  EmptyState,
  Input,
  Label,
  Skeleton,
  StatusBadge,
  Textarea,
} from '@retailbooks/ui';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

type FiscalYearsResponse = { data: FiscalYear[] };
type FiscalYearResponse = { data: FiscalYear };
type FiscalPeriodResponse = { data: FiscalPeriod };

type TransitionAction = 'close' | 'lock' | 'reopen' | 'unlock';

const TRANSITION_LABELS: Record<TransitionAction, string> = {
  close: 'Close',
  lock: 'Lock',
  reopen: 'Reopen',
  unlock: 'Unlock',
};

const NEXT_ALLOWED: Record<FiscalPeriod['status'], TransitionAction[]> = {
  OPEN: ['close'],
  CLOSED: ['lock', 'reopen'],
  LOCKED: ['unlock'],
};

export function FiscalPeriodsManagement() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'periods.manage');
  const canClose = hasPermission(organization, 'periods.close');
  const canUnlock = hasPermission(organization, 'periods.unlock');

  const [years, setYears] = useState<FiscalYear[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [startsOn, setStartsOn] = useState('');
  const [transitionTarget, setTransitionTarget] = useState<{
    period: FiscalPeriod;
    action: TransitionAction;
  } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<FiscalYearsResponse>(
        `/organizations/${organizationId}/periods`,
      );
      setYears(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Fiscal periods could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generateFiscalYear() {
    if (!organizationId) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<FiscalYearResponse>(
        `/organizations/${organizationId}/periods/fiscal-years`,
        { method: 'POST', body: JSON.stringify(startsOn ? { startsOn } : {}) },
      );
      setNotice(`${response.data.label} was generated.`);
      setStartsOn('');
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That fiscal year could not be created.',
      );
    } finally {
      setGenerating(false);
    }
  }

  async function confirmTransition() {
    if (!organizationId || !transitionTarget) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<FiscalPeriodResponse>(
        `/organizations/${organizationId}/periods/${transitionTarget.period.id}/${transitionTarget.action}`,
        { method: 'POST', body: JSON.stringify(note ? { note } : {}) },
      );
      setNotice(`${response.data.code} is now ${response.data.status.toLowerCase()}.`);
      setTransitionTarget(null);
      setNote('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That period could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  function canTransition(action: TransitionAction): boolean {
    return action === 'close' || action === 'lock' ? canClose : canUnlock;
  }

  if (!years && !error) {
    return (
      <div className="rb-security-loading" aria-label="Loading fiscal periods">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="rb-security-stack">
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rb-auth-notice" role="status">
          {notice}
        </div>
      ) : null}

      {canManage ? (
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="fiscal-year-starts-on">
              Generate a fiscal year (optional start date)
            </Label>
            <Input
              id="fiscal-year-starts-on"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </div>
          <Button type="button" onClick={() => void generateFiscalYear()} loading={generating}>
            <CalendarPlus aria-hidden="true" /> Generate fiscal year
          </Button>
        </Card>
      ) : null}

      {years && years.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No fiscal years yet"
          description="Generate the current fiscal year to start posting journals into open periods."
          action={
            canManage ? (
              <Button type="button" onClick={() => void generateFiscalYear()} loading={generating}>
                <CalendarPlus aria-hidden="true" /> Generate current fiscal year
              </Button>
            ) : undefined
          }
        />
      ) : (
        years?.map((year) => (
          <Card key={year.id} className="rb-security-section">
            <div className="rb-security-section__header">
              <div>
                <h2>{year.label}</h2>
                <p>
                  {year.startsOn} – {year.endsOn}
                </p>
              </div>
              <StatusBadge status={year.status} />
            </div>
            <div className="rb-table-scroll">
              <table className="rb-table rb-ledger-table">
                <caption className="rb-visually-hidden">{year.label} periods</caption>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Dates</th>
                    <th>Status</th>
                    <th className="rb-table--right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {year.periods.map((period) => (
                    <tr key={period.id}>
                      <td>
                        <strong>{period.name}</strong>
                        <span className="rb-table-secondary">{period.code}</span>
                      </td>
                      <td>
                        {period.startsOn} – {period.endsOn}
                      </td>
                      <td>
                        <StatusBadge status={period.status} />
                      </td>
                      <td className="rb-table--right">
                        <div className="rb-ledger-row-actions">
                          {NEXT_ALLOWED[period.status]
                            .filter((action) => canTransition(action))
                            .map((action) => (
                              <Button
                                key={action}
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => setTransitionTarget({ period, action })}
                              >
                                {TRANSITION_LABELS[action]}
                              </Button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <Dialog
        open={transitionTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTransitionTarget(null);
            setNote('');
          }
        }}
      >
        {transitionTarget ? (
          <DialogContent
            title={`${TRANSITION_LABELS[transitionTarget.action]} ${transitionTarget.period.name}?`}
            description="This is recorded as an audit event. You can add an optional note for context."
          >
            <div className="rb-field">
              <Label htmlFor="transition-note">Note (optional)</Label>
              <Textarea
                id="transition-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={240}
                rows={3}
              />
            </div>
            <div className="rb-dialog-footer">
              <Button type="button" variant="outline" onClick={() => setTransitionTarget(null)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void confirmTransition()} loading={busy}>
                {TRANSITION_LABELS[transitionTarget.action]}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
