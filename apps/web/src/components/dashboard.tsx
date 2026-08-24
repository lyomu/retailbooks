/*
THESIS: A calm accounting workbench inside RetailFlow's proven operational frame.
OWN-WORLD: Exact navy navigation, cool white workspace, cyan action signals, Urbanist type, and
ledger-like alignment from the supplied RetailFlow references.
STORY: The owner scans position first, verifies controls second, and reaches journals without
invented financial activity.
FIRST VIEWPORT: Full application shell, accounting KPIs, posted-activity volume, and control status.
FORM: Responsive 256/64px sidebar, 56px topbar, 1600px content cap, restrained panels, precise
tables, and honest empty states.
*/
'use client';

import type {
  FiscalYear,
  JournalSummary,
  LedgerAccount,
  TaxCode,
  TrialBalanceResponse,
} from '@retailbooks/contracts';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
  StatusBadge,
  type DataTableColumn,
} from '@retailbooks/ui';
import {
  ArrowUpRight,
  BarChart3,
  Book,
  BookOpenCheck,
  CalendarClock,
  FilePlus2,
  Landmark,
  Scale,
  SlidersHorizontal,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { apiRequest } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

type AccountResponse = { data: LedgerAccount[] };
type JournalListResponse = { data: JournalSummary[] };
type FiscalYearsResponse = { data: FiscalYear[] };
type TaxCodeResponse = { data: TaxCode[] };

type JournalPreview = {
  id: string;
  reference: string;
  date: string;
  description: string;
  amount: string;
  status: string;
};

const journalColumns: readonly DataTableColumn<JournalPreview>[] = [
  {
    key: 'reference',
    header: 'Journal',
    cell: (journal) => (
      <div>
        <strong>{journal.reference}</strong>
        <span className="rb-table-secondary">{journal.description}</span>
      </div>
    ),
  },
  { key: 'date', header: 'Date', cell: (journal) => journal.date, hideBelow: 'tablet' },
  { key: 'status', header: 'Status', cell: (journal) => <StatusBadge status={journal.status} /> },
  { key: 'amount', header: 'Amount', cell: (journal) => journal.amount, align: 'right' },
];

export function Dashboard() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const currency = organization?.baseCurrency ?? 'KES';

  const [accounts, setAccounts] = useState<LedgerAccount[] | null>(null);
  const [journals, setJournals] = useState<JournalSummary[] | null>(null);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceResponse['data'] | null>(null);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[] | null>(null);
  const [taxCodes, setTaxCodes] = useState<TaxCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [accountResponse, journalResponse, trialBalanceResponse, periodsResponse, taxResponse] =
        await Promise.all([
          apiRequest<AccountResponse>(`/organizations/${organizationId}/accounts`),
          apiRequest<JournalListResponse>(`/organizations/${organizationId}/journals`),
          apiRequest<TrialBalanceResponse>(
            `/organizations/${organizationId}/reports/trial-balance?asOf=${today}`,
          ),
          apiRequest<FiscalYearsResponse>(`/organizations/${organizationId}/periods`),
          apiRequest<TaxCodeResponse>(`/organizations/${organizationId}/tax/codes`),
        ]);
      setAccounts(accountResponse.data);
      setJournals(journalResponse.data);
      setTrialBalance(trialBalanceResponse.data);
      setFiscalYears(periodsResponse.data);
      setTaxCodes(taxResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The dashboard could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const draftCount = journals?.filter((journal) => journal.status === 'DRAFT').length ?? 0;
  const postedCount = journals?.filter((journal) => journal.status === 'POSTED').length ?? 0;
  const activeAccountCount = accounts?.filter((account) => account.status === 'ACTIVE').length ?? 0;
  const currentPeriod = useMemo(() => findOpenPeriod(fiscalYears), [fiscalYears]);
  const monthlyVolume = useMemo(() => volumeByMonth(journals ?? []), [journals]);
  const recentJournals = useMemo(
    () => (journals ?? []).slice(0, 8).map((journal) => toPreview(journal, currency)),
    [journals, currency],
  );

  const chartOfAccountsReady = (accounts ?? []).some((account) => !account.systemSeed);
  const taxCodesReady = (taxCodes ?? []).some((code) => !code.systemSeed);
  const fiscalYearReady = (fiscalYears?.length ?? 0) > 0;

  const controlItems: {
    label: string;
    description: string;
    href: string;
    icon: LucideIcon;
    ready: boolean;
  }[] = [
    {
      label: 'Fiscal periods',
      description: fiscalYearReady
        ? 'Fiscal years are generated.'
        : 'Generate a fiscal year to post.',
      href: '/periods',
      icon: CalendarClock,
      ready: fiscalYearReady,
    },
    {
      label: 'Chart of accounts',
      description: chartOfAccountsReady
        ? 'Customized beyond the starter chart.'
        : 'Still the untouched starter chart.',
      href: '/accounts',
      icon: BookOpenCheck,
      ready: chartOfAccountsReady,
    },
    {
      label: 'Tax codes',
      description: taxCodesReady
        ? 'Customized beyond the starter set.'
        : 'Still the untouched starter set.',
      href: '/tax',
      icon: Landmark,
      ready: taxCodesReady,
    },
  ];

  const nextActions: { href: string; icon: LucideIcon; title: string; description: string }[] = [
    !fiscalYearReady
      ? {
          href: '/periods',
          icon: CalendarClock,
          title: 'Generate a fiscal year',
          description: 'Journals need an open period before they can post.',
        }
      : {
          href: '/journals/new',
          icon: FilePlus2,
          title: 'Post your first journal',
          description: 'Start a balanced draft and post it into the open period.',
        },
    {
      href: '/accounts',
      icon: WalletCards,
      title: 'Chart of accounts',
      description: 'Review or tune the starter chart.',
    },
    {
      href: '/numbering',
      icon: SlidersHorizontal,
      title: 'Numbering rules',
      description: 'Define journal references by organization.',
    },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your accounting position and controls at a glance."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/design-system">
                <Book aria-hidden="true" /> Design system
              </Link>
            </Button>
            <Button asChild>
              <Link href="/journals/new">
                <FilePlus2 aria-hidden="true" /> New journal
              </Link>
            </Button>
          </>
        }
      />

      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="rb-dashboard-stats" aria-label="Accounting overview">
        <StatCard
          label="Accounts"
          value={accounts ? String(activeAccountCount) : '—'}
          icon={WalletCards}
          hint="active in the chart of accounts"
        />
        <StatCard
          label="Journals"
          value={journals ? String(postedCount) : '—'}
          icon={FilePlus2}
          hint={
            draftCount > 0
              ? `${draftCount} draft${draftCount === 1 ? '' : 's'} awaiting posting`
              : 'No drafts awaiting posting'
          }
          tone="info"
        />
        <StatCard
          label="Trial balance"
          value={
            trialBalance ? (trialBalance.totals.balanced ? 'Balanced' : 'Out of balance') : '—'
          }
          icon={Scale}
          hint={
            trialBalance
              ? `Dr ${formatMinor(trialBalance.totals.debitMinor, currency)} · Cr ${formatMinor(trialBalance.totals.creditMinor, currency)}`
              : 'Loading...'
          }
          tone={trialBalance ? (trialBalance.totals.balanced ? 'success' : 'warning') : undefined}
        />
        <StatCard
          label="Fiscal year"
          value={currentPeriod ? currentPeriod.name : 'Not started'}
          icon={CalendarClock}
          hint={currentPeriod ? 'currently open period' : 'generate a fiscal year to begin'}
          tone={currentPeriod ? 'success' : 'warning'}
        />
      </section>

      <section className="rb-dashboard-grid" aria-label="Financial activity">
        <Card className="rb-chart-panel">
          <div className="rb-panel-heading">
            <div>
              <h2>Posted activity</h2>
              <p>
                Posted journals per month, last 6 months
                {journals && journals.length >= 100 ? ' (last 100 journals)' : ''}
              </p>
            </div>
          </div>
          {journals && postedCount === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No posted journals yet"
              description="Post a balanced journal to see activity here."
            />
          ) : (
            <div className="rb-chart-area" aria-label="Posted journals per month">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyVolume} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 28% 91%)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: 'hsl(215 16% 47%)' }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: 'hsl(215 16% 47%)' }}
                  />
                  <Tooltip />
                  <Bar dataKey="posted" fill="hsl(194 82% 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="rb-control-panel">
          <div className="rb-panel-heading">
            <div>
              <h2>Control status</h2>
              <p>Foundation checks for this workspace</p>
            </div>
          </div>
          <ul className="rb-control-list">
            {controlItems.map((item) => (
              <li key={item.label}>
                <span
                  className={item.ready ? 'rb-control-icon is-ready' : 'rb-control-icon is-review'}
                >
                  <item.icon aria-hidden="true" />
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </div>
                <StatusBadge status={item.ready ? 'Complete' : 'Review'} />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section
        className="rb-dashboard-grid rb-dashboard-grid--lower"
        aria-label="Journals and next actions"
      >
        <div>
          <div className="rb-section-heading">
            <div>
              <h2>Recent journals</h2>
              <p>The most recently created draft and posted journals.</p>
            </div>
          </div>
          {!journals && !error ? (
            <div className="rb-security-loading" aria-label="Loading recent journals">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : (
            <DataTable
              caption="Recent journals"
              columns={journalColumns}
              rows={recentJournals}
              emptyTitle="No journals yet"
              emptyDescription="Create a balanced draft from Journals, then post it into an open period."
            />
          )}
        </div>

        <Card className="rb-actions-panel">
          <div className="rb-panel-heading">
            <div>
              <h2>Next actions</h2>
              <p>Set up the controls required before posting.</p>
            </div>
          </div>
          <div className="rb-action-list">
            {nextActions.map((action) => (
              <Link className="rb-action-row" href={action.href} key={action.href}>
                <span className="rb-action-row__icon">
                  <action.icon aria-hidden="true" />
                </span>
                <div>
                  <strong>{action.title}</strong>
                  <span>{action.description}</span>
                </div>
                <ArrowUpRight aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Card>
      </section>
    </>
  );
}

function findOpenPeriod(fiscalYears: FiscalYear[] | null): { code: string; name: string } | null {
  if (!fiscalYears) return null;
  for (const year of fiscalYears) {
    const open = year.periods.find((period) => period.status === 'OPEN');
    if (open) return { code: open.code, name: open.name };
  }
  return null;
}

function volumeByMonth(
  journals: readonly JournalSummary[],
): { key: string; label: string; posted: number }[] {
  const months: { key: string; label: string; posted: number }[] = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });
    months.push({ key, label, posted: 0 });
  }
  const byKey = new Map(months.map((month) => [month.key, month]));
  for (const journal of journals) {
    if (journal.status !== 'POSTED') continue;
    const key = journal.journalDate.slice(0, 7);
    const bucket = byKey.get(key);
    if (bucket) bucket.posted += 1;
  }
  return months;
}

function toPreview(journal: JournalSummary, currency: string): JournalPreview {
  return {
    id: journal.id,
    reference: journal.reference ?? 'Draft',
    date: journal.journalDate,
    description: journal.description,
    amount: formatMinor(journal.debitMinor, currency),
    status: journal.status,
  };
}

function formatMinor(value: string, currency: string): string {
  const amount = BigInt(value);
  const whole = amount / 100n;
  const cents = amount % 100n;
  const formattedWhole = new Intl.NumberFormat('en-KE').format(Number(whole));
  return `${currency} ${formattedWhole}.${cents.toString().padStart(2, '0')}`;
}
