import { Dashboard } from '../../components/dashboard';
import { AppShell } from '../../components/app-shell';

export default function DashboardPage() {
  return (
    <AppShell>
      <div id="main-content" tabIndex={-1}>
        <Dashboard />
      </div>
    </AppShell>
  );
}
