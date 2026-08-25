'use client';

import type { StatementResponse } from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ForbiddenState,
  Input,
  Label,
  PageHeader,
  Skeleton,
} from '@retailbooks/ui';
import { ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

export function CustomerStatementPage({ contactId }: { contactId: string }) {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canView = hasPermission(organization, 'sales.statements.view');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today());
  const [statement, setStatement] = useState<StatementResponse['data'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    try {
      const response = await apiRequest<StatementResponse>(
        `/organizations/${organizationId}/customers/${contactId}/statement?${params.toString()}`,
      );
      setStatement(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Statement could not be loaded.');
    }
  }, [contactId, from, organizationId, to]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspace.loading && organization && !canView) {
    return (
      <ForbiddenState description="Ask an organization owner, administrator, or accountant to grant statement access." />
    );
  }

  const currency = statement?.contact.currency ?? organization?.baseCurrency ?? 'KES';

  return (
    <>
      <PageHeader
        title={statement ? `${statement.contact.displayName} statement` : 'Customer statement'}
        description="Invoices issued, payments allocated, and credit notes applied, with a running balance."
        actions={
          <Button asChild variant="outline">
            <Link href="/customers">Back to customers</Link>
          </Button>
        }
      />
      <div className="rb-ledger-stack">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        <Card className="rb-ledger-toolbar">
          <div className="rb-field">
            <Label htmlFor="statement-from">From</Label>
            <Input
              id="statement-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="statement-to">To</Label>
            <Input
              id="statement-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <Badge>
            Closing {formatMinor(statement?.summary.closingBalanceMinor ?? '0', currency)}
          </Badge>
        </Card>

        {!statement && !error ? <Skeleton /> : null}

        {statement ? (
          <Card className="rb-ledger-toolbar">
            <div className="rb-field">
              <Label>Opening balance</Label>
              <strong>{formatMinor(statement.summary.openingBalanceMinor, currency)}</strong>
            </div>
            <div className="rb-field">
              <Label>Invoiced</Label>
              <strong>{formatMinor(statement.summary.invoicedMinor, currency)}</strong>
            </div>
            <div className="rb-field">
              <Label>Payments allocated</Label>
              <strong>{formatMinor(statement.summary.paymentsAllocatedMinor, currency)}</strong>
            </div>
            <div className="rb-field">
              <Label>Credit notes allocated</Label>
              <strong>{formatMinor(statement.summary.creditNotesAllocatedMinor, currency)}</strong>
            </div>
            <div className="rb-field">
              <Label>Closing balance</Label>
              <strong>{formatMinor(statement.summary.closingBalanceMinor, currency)}</strong>
            </div>
          </Card>
        ) : null}

        {statement?.transactions.length ? (
          <div className="rb-table-scroll">
            <table className="rb-table rb-ledger-table">
              <caption className="rb-visually-hidden">Customer statement transactions</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="rb-table--right">Debit</th>
                  <th className="rb-table--right">Credit</th>
                  <th className="rb-table--right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.transactions.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td>{row.description}</td>
                    <td className="rb-table--right rb-num">
                      {formatMinor(row.debitMinor, currency)}
                    </td>
                    <td className="rb-table--right rb-num">
                      {formatMinor(row.creditMinor, currency)}
                    </td>
                    <td className="rb-table--right rb-num">
                      {formatMinor(row.balanceMinor, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : statement ? (
          <EmptyState
            icon={ListChecks}
            title="No activity in this range"
            description="Invoices, payments, and credit notes for this customer will appear here."
          />
        ) : null}
      </div>
    </>
  );
}

function formatMinor(value: string, currency: string): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const cents = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat('en-KE').format(Number(whole));
  return `${negative ? '-' : ''}${currency} ${formattedWhole}.${cents.toString().padStart(2, '0')}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
