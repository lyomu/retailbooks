import { AppShell } from '../../components/app-shell';
import { DesignSystemCatalog } from '../../components/design-system-catalog';

export default function DesignSystemPage() {
  return (
    <AppShell requireOrganization={false}>
      <div id="main-content" tabIndex={-1}>
        <DesignSystemCatalog />
      </div>
    </AppShell>
  );
}
