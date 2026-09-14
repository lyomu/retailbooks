import type { ReactNode } from 'react';

import '@retailbooks/ui/tokens.css';
import './marketing.css';
import './marketing-additions.css';

import { SiteFooter } from '../../components/marketing/site-footer';
import { SiteHeader } from '../../components/marketing/site-header';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mk-root">
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </div>
  );
}
