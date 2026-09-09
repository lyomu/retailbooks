import type { Metadata } from 'next';

import { PlatformAudit } from '../../../components/platform-operations';

export const metadata: Metadata = { title: 'Platform audit | RetailBooks platform' };

export default function PlatformAuditRoute() {
  return <PlatformAudit />;
}
