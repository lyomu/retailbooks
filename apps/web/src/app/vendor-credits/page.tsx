import type { Metadata } from 'next';

import { AppShell } from '../../components/app-shell';
import { VendorCreditsPage } from '../../components/vendor-credits-workbench';

export const metadata: Metadata = { title: 'Vendor credits | RetailBooks' };

export default function VendorCreditsRoute() {
  return (
    <AppShell>
      <VendorCreditsPage />
    </AppShell>
  );
}
