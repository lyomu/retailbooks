/*
THESIS: A calm accounting workbench inside RetailFlow's proven operational frame.
OWN-WORLD: Exact navy navigation, cool white workspace, cyan action signals, Urbanist type, and
ledger-like alignment from the supplied RetailFlow references.
STORY: The owner scans position first, verifies controls second, and reaches journals without
invented financial activity.
FIRST VIEWPORT: Full application shell, accounting KPIs, cash movement, and control status.
FORM: Responsive 256/64px sidebar, 56px topbar, 1600px content cap, restrained panels, precise
tables, and honest empty states.
*/
import { AppShell } from '../components/app-shell';
import { Dashboard } from '../components/dashboard';

export default function Home() {
  return (
    <AppShell>
      <div id="main-content" tabIndex={-1}>
        <Dashboard />
      </div>
    </AppShell>
  );
}
