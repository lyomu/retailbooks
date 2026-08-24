'use client';

import type { NumberingResponse } from '@retailbooks/contracts';
import { Badge, Button, FieldMessage, Input, Label, Select, Skeleton } from '@retailbooks/ui';
import { Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';

type JournalNumbering = NumberingResponse['data']['journal'];

export function NumberingSettings() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'numbering.manage');

  const [journal, setJournal] = useState<JournalNumbering | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const response = await apiRequest<NumberingResponse>(
        `/organizations/${organizationId}/numbering`,
      );
      setJournal(response.data.journal);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Numbering settings could not be loaded.',
      );
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        journalPrefix: formValue(data, 'journalPrefix'),
        numberPadding: Number(data.get('numberPadding')),
        nextJournalNumber: Number(data.get('nextJournalNumber')),
        numberingReset: data.get('numberingReset'),
      };
      const response = await apiRequest<NumberingResponse>(
        `/organizations/${organizationId}/numbering/journal`,
        { method: 'PATCH', body: JSON.stringify(payload) },
      );
      setJournal(response.data.journal);
      setNotice('Journal numbering updated.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Numbering could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (!journal && !error) {
    return (
      <div className="rb-security-loading" aria-label="Loading numbering settings">
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

      {journal ? (
        <>
          <section className="rb-security-section" aria-labelledby="numbering-journal-title">
            <div className="rb-security-section__header">
              <div>
                <h2 id="numbering-journal-title">Journal numbering</h2>
                <p>Prefix, padding, reset cadence, and the next number to allocate.</p>
              </div>
              <Badge tone="info">
                Current scope {journal.currentScope.token ?? journal.currentScope.key}
              </Badge>
            </div>
            <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
              <div className="rb-field-grid">
                <div className="rb-field">
                  <Label htmlFor="numbering-prefix">Prefix</Label>
                  <Input
                    id="numbering-prefix"
                    name="journalPrefix"
                    defaultValue={journal.prefix}
                    disabled={!canManage}
                    maxLength={12}
                    required
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="numbering-padding">Number padding</Label>
                  <Input
                    id="numbering-padding"
                    name="numberPadding"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={journal.numberPadding}
                    disabled={!canManage}
                    required
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="numbering-next">Next number</Label>
                  <Input
                    id="numbering-next"
                    name="nextJournalNumber"
                    type="number"
                    min={1}
                    defaultValue={journal.nextJournalNumber}
                    disabled={!canManage}
                    required
                  />
                </div>
                <div className="rb-field">
                  <Label htmlFor="numbering-reset">Reset cadence</Label>
                  <Select
                    id="numbering-reset"
                    name="numberingReset"
                    defaultValue={journal.numberingReset}
                    disabled={!canManage}
                  >
                    <option value="NEVER">Never</option>
                    <option value="ANNUAL">Annually</option>
                    <option value="MONTHLY">Monthly</option>
                  </Select>
                </div>
              </div>
              <FieldMessage>
                Lowering the next number below one already allocated can produce duplicate-looking
                references. Changes take effect on the current scope shown above.
              </FieldMessage>
              {canManage ? (
                <div className="rb-dialog-footer">
                  <Button type="submit" loading={saving}>
                    <Save aria-hidden="true" /> Save numbering
                  </Button>
                </div>
              ) : null}
            </form>
          </section>

          <section className="rb-security-section" aria-labelledby="numbering-history-title">
            <div className="rb-security-section__header">
              <div>
                <h2 id="numbering-history-title">Sequence history</h2>
                <p>Every scope this organization has allocated journal numbers under.</p>
              </div>
            </div>
            <div className="rb-table-scroll">
              <table className="rb-table rb-ledger-table">
                <caption className="rb-visually-hidden">Journal numbering sequence history</caption>
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Prefix</th>
                    <th className="rb-table--right">Last allocated</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.sequences.map((sequence) => (
                    <tr key={sequence.id}>
                      <td>{sequence.scopeKey}</td>
                      <td>{sequence.prefix}</td>
                      <td className="rb-table--right rb-num">
                        {sequence.lastAllocatedNumber ?? '—'}
                      </td>
                      <td>
                        {sequence.lastAllocatedAt
                          ? new Date(sequence.lastAllocatedAt).toLocaleString()
                          : 'Not yet used'}
                      </td>
                    </tr>
                  ))}
                  {journal.sequences.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No journal numbers have been allocated yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
