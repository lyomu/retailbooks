import type { Metadata } from 'next';

import { PlatformJobs } from '../../../components/platform-operations';

export const metadata: Metadata = { title: 'Jobs | RetailBooks platform' };

export default function PlatformJobsRoute() {
  return <PlatformJobs />;
}
