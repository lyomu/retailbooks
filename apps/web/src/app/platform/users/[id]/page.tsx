import type { Metadata } from 'next';

import { PlatformUserDetail } from '../../../../components/platform-users';

export const metadata: Metadata = { title: 'User | RetailBooks platform' };

export default async function PlatformUserRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <PlatformUserDetail userId={id} />;
}
