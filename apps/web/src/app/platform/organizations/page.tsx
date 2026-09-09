import type { Metadata } from 'next';

import { PlatformOrganizations } from '../../../components/platform-organizations';

export const metadata: Metadata = { title: 'Organizations | RetailBooks platform' };

export default function PlatformOrganizationsRoute() {
  return <PlatformOrganizations />;
}
