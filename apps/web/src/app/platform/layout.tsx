import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { PlatformShell } from '../../components/platform-shell';

export const metadata: Metadata = { title: 'Platform console | RetailBooks' };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
