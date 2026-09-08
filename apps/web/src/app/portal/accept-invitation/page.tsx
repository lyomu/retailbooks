import type { Metadata } from 'next';
import { PortalInvitation } from '../../../components/portal-invitation';
export const metadata: Metadata = { title: 'Accept customer portal invitation | RetailBooks' };
export default async function AcceptPortalInvitation({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return <PortalInvitation token={(await searchParams).token} />;
}
