import type { Metadata } from 'next';
import type { ReportFilters } from '@retailbooks/contracts';

import { AppShell } from '../../../components/app-shell';
import { ReportRunnerPage } from '../../../components/reports-workbench';

export const metadata: Metadata = { title: 'Report | RetailBooks' };

export default async function ReportRoute({
  params,
  searchParams,
}: {
  params: Promise<{ reportKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reportKey } = await params;
  const rawFilters = await searchParams;
  const initialFilters = Object.fromEntries(
    Object.entries(rawFilters).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  ) as Partial<ReportFilters>;
  return (
    <AppShell>
      <ReportRunnerPage reportKey={reportKey} initialFilters={initialFilters} />
    </AppShell>
  );
}
