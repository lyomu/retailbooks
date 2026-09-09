import type { Metadata } from 'next';

import { PlatformFeatureFlags } from '../../../components/platform-catalog';

export const metadata: Metadata = { title: 'Feature flags | RetailBooks platform' };

export default function PlatformFeatureFlagsRoute() {
  return <PlatformFeatureFlags />;
}
