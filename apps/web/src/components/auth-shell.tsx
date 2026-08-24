import { BookOpenCheck, CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="rb-auth" id="main-content">
      <section className="rb-auth__main" aria-labelledby="auth-title">
        <div className="rb-auth__content">
          <Link className="rb-auth__brand" href="/" aria-label="RetailBooks home">
            <span className="rb-auth__brand-mark">
              <BookOpenCheck aria-hidden="true" />
            </span>
            <span>
              <strong>RetailBooks</strong>
              <small>Accounting, made operational</small>
            </span>
          </Link>
          <div className="rb-auth__heading">
            <h1 id="auth-title">{title}</h1>
            <p>{description}</p>
          </div>
          {children}
        </div>
        <p className="rb-auth__legal">
          By continuing, you agree to the RetailBooks terms and privacy policy.
        </p>
      </section>

      <aside className="rb-auth__aside" aria-label="Product assurance">
        <div className="rb-auth__aside-content">
          <span className="rb-auth__assurance-icon">
            <ShieldCheck aria-hidden="true" />
          </span>
          <h2>Start with a trustworthy accounting foundation.</h2>
          <p>
            Your workspace begins with secure access, a verifiable audit trail, and organization
            boundaries built into every workflow.
          </p>
          <ul>
            <li>
              <LockKeyhole aria-hidden="true" />
              <span>
                <strong>Secure by design</strong>Adaptive password hashing and protected sessions.
              </span>
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>Ready for your team</strong>Roles and permissions arrive with organization
                setup.
              </span>
            </li>
            <li>
              <BookOpenCheck aria-hidden="true" />
              <span>
                <strong>Ledger-ready</strong>Accounting configuration follows immediately after
                access.
              </span>
            </li>
          </ul>
        </div>
        <p className="rb-auth__aside-note">
          Built for business owners, finance teams, and advisers.
        </p>
      </aside>
    </main>
  );
}
