'use client';

import {
  Activity,
  Building2,
  Flag,
  Gauge,
  Layers,
  ScrollText,
  ShieldAlert,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { usePlatformSession } from '../lib/platform';

const NAV = [
  { href: '/platform', label: 'Overview', icon: Gauge },
  { href: '/platform/organizations', label: 'Organizations', icon: Building2 },
  { href: '/platform/users', label: 'Users', icon: Users },
  { href: '/platform/plans', label: 'Plans', icon: Layers },
  { href: '/platform/feature-flags', label: 'Feature flags', icon: Flag },
  { href: '/platform/jobs', label: 'Jobs', icon: Activity },
  { href: '/platform/security', label: 'Security', icon: ShieldAlert },
  { href: '/platform/audit', label: 'Audit', icon: ScrollText },
] as const;

/**
 * The platform console shell — a separate surface from the tenant app, with its own boundary.
 *
 * It shares no chrome with `AppShell` on purpose. The tenant shell is built around an organization
 * switcher and tenant navigation, neither of which a platform administrator has: they are not a
 * member of anything. Reusing it would mean carrying an empty organization context through a
 * console that must never acquire one.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const { session, state } = usePlatformSession();
  const pathname = usePathname();

  if (state === 'loading') {
    return <PlatformNotice title="Loading the console" copy="Checking your platform access." />;
  }
  if (state === 'signed-out') {
    return (
      <PlatformNotice
        title="Sign in to continue"
        copy="The platform console needs a signed-in RetailBooks account."
        action={{ href: '/login', label: 'Sign in' }}
      />
    );
  }
  if (state === 'forbidden') {
    return (
      <PlatformNotice
        title="You do not have platform access"
        copy="Platform administration is granted per person by an existing superadmin. If you expected access here, ask them to grant it."
        action={{ href: '/', label: 'Back to RetailBooks' }}
      />
    );
  }
  if (state === 'error') {
    return (
      <PlatformNotice
        title="The console could not be loaded"
        copy="Refresh to try again."
        action={{ href: '/platform', label: 'Reload' }}
      />
    );
  }

  return (
    <div className="rb-platform">
      <header className="rb-platform__bar">
        <Link href="/platform" className="rb-platform__brand">
          <ShieldAlert aria-hidden="true" />
          <span>
            RetailBooks <strong>Platform</strong>
          </span>
        </Link>
        <div className="rb-platform__identity">
          <span className="rb-platform__role">{session?.role.toLowerCase()}</span>
          <span>{session?.email}</span>
          <Link href="/">Exit console</Link>
        </div>
      </header>
      <div className="rb-platform__body">
        <nav className="rb-platform__nav" aria-label="Platform console">
          {NAV.map((item) => {
            const active =
              item.href === '/platform' ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={active ? 'is-active' : undefined}
              >
                <item.icon aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main id="main-content" className="rb-platform__main">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PlatformNotice({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: { href: string; label: string };
}) {
  return (
    <main id="main-content" className="rb-platform-notice">
      <ShieldAlert aria-hidden="true" />
      <h1>{title}</h1>
      <p>{copy}</p>
      {action ? <Link href={action.href}>{action.label}</Link> : null}
    </main>
  );
}

/** Standard page heading inside the console, so every screen introduces itself the same way. */
export function PlatformPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="rb-platform__heading">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="rb-platform__heading-actions">{actions}</div> : null}
      </div>
      {children}
    </>
  );
}
