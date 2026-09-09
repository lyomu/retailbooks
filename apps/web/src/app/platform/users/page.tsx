import type { Metadata } from 'next';

import { PlatformUsers } from '../../../components/platform-users';

export const metadata: Metadata = { title: 'Users | RetailBooks platform' };

export default function PlatformUsersRoute() {
  return <PlatformUsers />;
}
