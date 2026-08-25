'use client';

import {
  Dialog,
  DrawerContent,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@retailbooks/ui';
import {
  Banknote,
  Bell,
  BookOpenText,
  Building2,
  Calculator,
  CalendarClock,
  CircleDollarSign,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FileClock,
  FileQuestion,
  FileText,
  Landmark,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  Receipt,
  Repeat,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Undo2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';
import { OrganizationSwitcher } from './organization-switcher';

type NavigationItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href?: string;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const navigationGroups: NavigationGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
      { label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Customers', icon: Users, href: '/customers' },
      { label: 'Items & services', icon: Package, href: '/catalog/items' },
      { label: 'Invoices', icon: Receipt, href: '/invoices' },
      { label: 'Payments', icon: Banknote, href: '/payments' },
      { label: 'Credit notes', icon: Undo2, href: '/credit-notes' },
      { label: 'Quotes', icon: FileQuestion, href: '/quotes' },
      { label: 'Sales orders', icon: ClipboardList, href: '/sales-orders' },
      { label: 'Recurring invoices', icon: Repeat, href: '/recurring-invoices' },
    ],
  },
  {
    label: 'Purchases',
    items: [
      { label: 'Vendors', icon: Users, href: '/vendors' },
      { label: 'Purchase orders', icon: ClipboardList, href: '/purchase-orders' },
      { label: 'Bills', icon: Receipt, href: '/bills' },
      { label: 'Expenses', icon: Banknote, href: '/expenses' },
      { label: 'Expense categories', icon: Package, href: '/expense-categories' },
      { label: 'Vendor credits', icon: Undo2, href: '/vendor-credits' },
      { label: 'Payments made', icon: Banknote, href: '/payments-made' },
      { label: 'Recurring bills', icon: Repeat, href: '/recurring-bills' },
      { label: 'Recurring expenses', icon: Repeat, href: '/recurring-expenses' },
    ],
  },
  {
    label: 'General ledger',
    items: [
      { label: 'Chart of accounts', icon: BookOpenText, href: '/accounts' },
      { label: 'Journals', icon: FileText, href: '/journals' },
      { label: 'Trial balance', icon: Calculator, href: '/trial-balance' },
      { label: 'Account ledger', icon: FileClock, href: '/accounts' },
    ],
  },
  {
    label: 'Finance controls',
    items: [
      { label: 'Fiscal periods', icon: CalendarClock, href: '/periods' },
      { label: 'Tax codes', icon: Landmark, href: '/tax' },
      { label: 'Numbering', icon: SlidersHorizontal, href: '/numbering' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { label: 'Organization profile', icon: Building2, href: '/settings/organization' },
      { label: 'Currencies', icon: CircleDollarSign, href: '/settings/currencies' },
      { label: 'Team & roles', icon: Users, href: '/settings/team' },
      { label: 'Audit log', icon: ShieldCheck, href: '/settings/audit-log' },
      { label: 'Security', icon: Settings, href: '/settings/security' },
      { label: 'Design system', icon: SlidersHorizontal, href: '/design-system' },
    ],
  },
];

function RetailBooksMark({ onExpand }: { onExpand?: () => void }) {
  if (onExpand) {
    return (
      <button
        className="rb-brand-mark"
        type="button"
        onClick={onExpand}
        aria-label="Expand sidebar"
      >
        <BookOpenText aria-hidden="true" />
      </button>
    );
  }

  return (
    <span className="rb-brand-mark" aria-hidden="true">
      <BookOpenText />
    </span>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navigationGroups.map((group) => [group.label, true])),
  );

  return (
    <aside className={collapsed ? 'rb-app-sidebar is-collapsed' : 'rb-app-sidebar'}>
      <div className="rb-app-sidebar__brand">
        <RetailBooksMark onExpand={collapsed ? onToggle : undefined} />
        {!collapsed ? (
          <div className="rb-app-sidebar__brand-copy">
            <strong>RetailBooks</strong>
            <span>Accounting, clearly</span>
          </div>
        ) : null}
        <button
          className="rb-app-sidebar__toggle"
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
      </div>

      <nav className="rb-app-sidebar__nav" aria-label="Primary navigation">
        {navigationGroups.map((group) => {
          const open = openGroups[group.label] ?? true;
          return (
            <section className="rb-nav-group" key={group.label}>
              {!collapsed ? (
                <button
                  className="rb-nav-group__trigger"
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.label]: !open }))}
                >
                  <span>{group.label}</span>
                  <ChevronDown className={open ? 'is-open' : ''} />
                </button>
              ) : null}

              {open || collapsed ? (
                <ul>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = Boolean(item.href && pathname === item.href);
                    return (
                      <li key={item.label}>
                        {item.href ? (
                          <Link
                            className={active ? 'rb-nav-item is-active' : 'rb-nav-item'}
                            href={item.href}
                            title={collapsed ? item.label : undefined}
                            onClick={onNavigate}
                          >
                            <Icon aria-hidden="true" />
                            {!collapsed ? <span>{item.label}</span> : null}
                          </Link>
                        ) : (
                          <span
                            className="rb-nav-item is-upcoming"
                            aria-label={`${item.label}, coming in a later milestone`}
                            title={collapsed ? `${item.label} — upcoming` : 'Upcoming'}
                          >
                            <Icon aria-hidden="true" />
                            {!collapsed ? <span>{item.label}</span> : null}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="rb-app-sidebar__help">
          <CircleHelp aria-hidden="true" />
          <div>
            <strong>Need a hand?</strong>
            <span>Phase 1 workspace</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

type QuickCreateEntry = {
  label: string;
  href: string;
  permission: Parameters<typeof hasPermission>[1];
};

const quickCreateEntries: readonly QuickCreateEntry[] = [
  { label: 'Vendor', href: '/vendors', permission: 'vendors.manage' },
  { label: 'Purchase order', href: '/purchase-orders/new', permission: 'purchases.orders.manage' },
  { label: 'Bill', href: '/bills/new', permission: 'purchases.bills.manage' },
  { label: 'Expense', href: '/expenses/new', permission: 'purchases.expenses.manage' },
  {
    label: 'Payment made',
    href: '/payments-made/new',
    permission: 'purchases.payments_made.record',
  },
];

function QuickCreateMenu({
  organization,
}: {
  organization: ReturnType<typeof useWorkspace>['activeOrganization'];
}) {
  const entries = quickCreateEntries.filter((entry) =>
    hasPermission(organization, entry.permission),
  );
  if (entries.length === 0) return null;

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button className="rb-icon-button rb-quick-create-button" type="button">
          <Plus aria-hidden="true" />
          <span className="rb-visually-hidden">Quick create</span>
        </button>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownLabel>Quick create</DropdownLabel>
        <DropdownSeparator />
        {entries.map((entry) => (
          <DropdownItem asChild key={entry.href}>
            <Link href={entry.href}>{entry.label}</Link>
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

function TopBar({
  onMenuClick,
  workspace,
}: {
  onMenuClick: () => void;
  workspace: ReturnType<typeof useWorkspace>;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const displayName = workspace.user?.displayName ?? 'RetailBooks';
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  async function signOut() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="rb-topbar">
      <button className="rb-icon-button rb-topbar__menu" type="button" onClick={onMenuClick}>
        <Menu aria-hidden="true" />
        <span className="rb-visually-hidden">Open navigation</span>
      </button>

      <OrganizationSwitcher
        organizations={workspace.organizations}
        activeOrganization={workspace.activeOrganization}
        onSwitched={() => void workspace.refresh()}
      />

      <label className="rb-global-search">
        <Search aria-hidden="true" />
        <span className="rb-visually-hidden">Search RetailBooks</span>
        <input ref={searchRef} placeholder="Search accounts, journals, reports..." />
        <kbd>⌘K</kbd>
      </label>

      <div className="rb-topbar__actions">
        {workspace.activeOrganization ? (
          <span className="rb-online-badge">
            <span aria-hidden="true" /> {workspace.activeOrganization.baseCurrency}
          </span>
        ) : null}
        <QuickCreateMenu organization={workspace.activeOrganization} />
        <button className="rb-icon-button rb-notification-button" type="button">
          <Bell aria-hidden="true" />
          <span className="rb-notification-button__dot" aria-hidden="true" />
          <span className="rb-visually-hidden">Notifications</span>
        </button>

        <Dropdown>
          <DropdownTrigger asChild>
            <button
              className="rb-profile-trigger"
              type="button"
              aria-label={`Open profile menu for ${displayName}`}
            >
              <span className="rb-avatar">{initials || 'RB'}</span>
              <span className="rb-profile-trigger__copy">
                <strong>{displayName}</strong>
                <small>
                  {workspace.activeOrganization
                    ? workspace.activeOrganization.role
                    : 'No organization'}
                </small>
              </span>
            </button>
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel>{displayName}</DropdownLabel>
            <DropdownSeparator />
            <DropdownItem asChild>
              <Link href="/settings/organization">Organization profile</Link>
            </DropdownItem>
            <DropdownItem asChild>
              <Link href="/settings/team">Team &amp; roles</Link>
            </DropdownItem>
            <DropdownItem asChild>
              <Link href="/settings/security">Security</Link>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem onSelect={() => void signOut()}>Sign out</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}

export function AppShell({
  children,
  requireOrganization = true,
}: {
  children: ReactNode;
  /** Account-level surfaces stay reachable before an organization exists. */
  requireOrganization?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const workspace = useWorkspace({ requireOrganization });

  return (
    <div className={collapsed ? 'rb-app-shell has-collapsed-sidebar' : 'rb-app-shell'}>
      <div className="rb-app-shell__desktop-nav">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent title="RetailBooks navigation" side="left">
          <Sidebar
            collapsed={false}
            onToggle={() => setMobileOpen(false)}
            onNavigate={() => setMobileOpen(false)}
          />
        </DrawerContent>
      </Dialog>

      <div className="rb-app-shell__workspace">
        <TopBar onMenuClick={() => setMobileOpen(true)} workspace={workspace} />
        <main className="rb-main-scroll">
          <div className="rb-page-container">{children}</div>
        </main>
      </div>
    </div>
  );
}
