import type { Metadata } from 'next';

import { PlatformOverview } from '../../components/platform-overview';

export const metadata: Metadata = { title: 'Platform overview | RetailBooks' };

export default function PlatformOverviewRoute() {
  return <PlatformOverview />;
}
