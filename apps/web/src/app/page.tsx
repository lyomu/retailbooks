/*
THESIS: A calm accounting workbench inside RetailFlow's proven operational frame.
OWN-WORLD: Navy navigation, cool white workspace, cyan action signals, Urbanist type, and precise
ledger-like alignment.
STORY: The user enters an established workspace, sees what is ready, and can trace the foundation
being built without fabricated financial activity.
FIRST VIEWPORT: Brand and navigation frame the page; foundation status, environment readiness, and
the next accounting capabilities are immediately legible.
FORM: Fixed sidebar and top bar, a restrained metric row, one primary progress panel, and a compact
readiness list. The page is a truthful implementation-state surface, not a fake dashboard.
*/
import {
  Bell,
  BookOpenText,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  FileClock,
  FileText,
  Gauge,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

const navigation = [
  { label: 'Dashboard', icon: LayoutDashboard, active: true },
  { label: 'Chart of accounts', icon: BookOpenText },
  { label: 'Journals', icon: FileText },
  { label: 'Fiscal periods', icon: FileClock },
];

const settingsNavigation = [
  { label: 'Organization', icon: Building2 },
  { label: 'Team & roles', icon: Users },
  { label: 'Audit log', icon: ShieldCheck },
  { label: 'Settings', icon: Settings },
];

const readiness = [
  { label: 'Product authority', detail: 'Scope and precedence recorded' },
  { label: 'Design authority', detail: 'RetailFlow language pinned' },
  { label: 'Portable infrastructure', detail: 'PostgreSQL, Redis, MinIO, Mailpit' },
];

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <BookOpenText size={27} strokeWidth={2.2} />
    </span>
  );
}

export default function Home() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <BrandMark />
          <div>
            <strong>RetailBooks</strong>
            <span>Accounting, clearly</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          <p className="nav-label">OVERVIEW</p>
          {navigation.map(({ label, icon: Icon, active }) => (
            <a className={active ? 'nav-item active' : 'nav-item'} href="#" key={label}>
              <Icon size={20} />
              <span>{label}</span>
            </a>
          ))}

          <p className="nav-label nav-section">MANAGE</p>
          {settingsNavigation.map(({ label, icon: Icon }) => (
            <a className="nav-item" href="#" key={label}>
              <Icon size={20} />
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-help">
          <CircleHelp size={20} />
          <div>
            <strong>Building together</strong>
            <span>Phase 1 foundation</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" type="button" aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <button className="organization-switcher" type="button">
            <Building2 size={19} />
            <span>RetailBooks Demo</span>
            <ChevronDown size={16} />
          </button>
          <label className="global-search">
            <Search size={20} />
            <span className="sr-only">Search RetailBooks</span>
            <input placeholder="Search accounts, journals, settings..." />
            <kbd>⌘K</kbd>
          </label>
          <div className="topbar-actions">
            <span className="environment-status">
              <span /> Local
            </span>
            <button className="icon-button" type="button" aria-label="Notifications">
              <Bell size={20} />
            </button>
            <span className="avatar" aria-label="Gideon Lyomu">
              GL
            </span>
          </div>
        </header>

        <main>
          <div className="page-heading">
            <div>
              <h1>Foundation workspace</h1>
              <p>RetailBooks is taking shape from an audit-safe, global accounting core.</p>
            </div>
            <button className="primary-button" type="button">
              <Gauge size={19} />
              View build plan
            </button>
          </div>

          <section className="metric-grid" aria-label="Foundation status">
            <article className="metric-card">
              <span>Current milestone</span>
              <strong>1A</strong>
              <small>Workspace & infrastructure</small>
            </article>
            <article className="metric-card">
              <span>Country pack</span>
              <strong>Kenya</strong>
              <small>Configurable draft defaults</small>
            </article>
            <article className="metric-card">
              <span>Base currency</span>
              <strong>KES</strong>
              <small>Multi-currency ready architecture</small>
            </article>
          </section>

          <section className="foundation-grid">
            <article className="panel progress-panel">
              <div className="panel-heading">
                <div>
                  <h2>Phase 1 foundation</h2>
                  <p>The groundwork for identity, tenancy, controls, and the ledger.</p>
                </div>
                <span className="status-badge">
                  <span /> In progress
                </span>
              </div>

              <div className="milestone-line" aria-hidden="true">
                <span style={{ width: '10%' }} />
              </div>

              <div className="milestone-copy">
                <strong>Milestone 1A — Workspace & infrastructure</strong>
                <span>Establishing the portable runtime and engineering quality gates.</span>
              </div>

              <div className="up-next">
                <span>UP NEXT</span>
                <strong>RetailFlow design foundation</strong>
                <p>Application shell, tokens, accessible primitives, and visual baselines.</p>
              </div>
            </article>

            <article className="panel readiness-panel">
              <div className="panel-heading">
                <div>
                  <h2>Foundation checks</h2>
                  <p>Verified project decisions</p>
                </div>
              </div>
              <ul>
                {readiness.map((item) => (
                  <li key={item.label}>
                    <span className="check-icon">
                      <Check size={16} />
                    </span>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          </section>
        </main>
      </div>
    </div>
  );
}
