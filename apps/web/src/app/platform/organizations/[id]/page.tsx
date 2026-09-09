import type { Metadata } from 'next';

import { PlatformOrganizationDetail } from '../../../../components/platform-organizations';

export const metadata: Metadata = { title: 'Organization | RetailBooks platform' };

export default async function PlatformOrganizationRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PlatformOrganizationDetail organizationId={id} />;
}
