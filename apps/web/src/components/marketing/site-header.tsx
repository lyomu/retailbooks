'use client';

import { BookOpen, Bot, BriefcaseBusiness, Building2, ChevronDown, Menu, ReceiptText, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const productLinks = [
  { href: '/invoicing', label: 'Invoicing', text: 'Invoice, quote, remind, and get paid.', icon: ReceiptText },
  { href: '/accounting', label: 'Accounting', text: 'Books, banking, journals, and reports.', icon: BookOpen },
  { href: '/product', label: 'Expenses & reporting', text: 'See every transaction in one place.', icon: BriefcaseBusiness },
  { href: '/ai', label: 'RetailBooks AI', text: 'A practical copilot for your finances.', icon: Sparkles },
];
const industries = [
  ['retail', 'Retail'], ['ecommerce', 'E-commerce'], ['agencies', 'Agencies & consultants'],
  ['restaurants', 'Restaurants & hospitality'], ['construction', 'Construction & trades'], ['professional-services', 'Professional services'],
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState<'product' | 'industries' | null>(null);
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setOpen(null); setMobile(false); }, [pathname]);
  const toggle = (name: 'product' | 'industries') => setOpen(open === name ? null : name);
  return (
    <header className="mk-header">
      <div className="mk-header__inner">
        <Link className="mk-brand" href="/" aria-label="RetailBooks home"><span><BookOpen aria-hidden="true" /></span><strong>RetailBooks</strong></Link>
        <nav className="mk-nav" aria-label="Marketing navigation">
          <button type="button" className={open === 'product' ? 'is-open' : ''} onClick={() => toggle('product')} aria-expanded={open === 'product'}>Product <ChevronDown aria-hidden="true" /></button>
          <button type="button" className={open === 'industries' ? 'is-open' : ''} onClick={() => toggle('industries')} aria-expanded={open === 'industries'}>Industries <ChevronDown aria-hidden="true" /></button>
          <Link href="/customers">Customers</Link><Link href="/security">Security</Link><Link href="/contact">Contact</Link>
        </nav>
        <div className="mk-header__actions"><Link className="mk-link-button" href="/login">Sign in</Link><Link className="mk-button mk-button--small" href="/signup">Try it free</Link></div>
        <button className="mk-menu-button" type="button" onClick={() => setMobile(!mobile)} aria-label={mobile ? 'Close navigation' : 'Open navigation'}>{mobile ? <X /> : <Menu />}</button>
      </div>
      {open === 'product' ? <div className="mk-mega"><div className="mk-mega__grid"><div><p className="mk-mega__label">Explore the platform</p><div className="mk-mega__links">{productLinks.map(({ href, label, text, icon: Icon }) => <Link href={href} key={href}><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{text}</small></span></Link>)}</div></div><Link href="/ai" className="mk-mega__feature"><span className="mk-mega__bot"><Bot aria-hidden="true" /></span><p>RetailBooks AI</p><strong>Ask a question. Get a clear next step.</strong><small>Built for the financial work already happening in your account.</small><span>Explore AI →</span></Link></div></div> : null}
      {open === 'industries' ? <div className="mk-mega mk-mega--industries"><div><p className="mk-mega__label">Built around how you work</p><div className="mk-industry-links">{industries.map(([slug, label]) => <Link href={`/industries/${slug}`} key={slug}><Building2 aria-hidden="true" />{label}<span>→</span></Link>)}</div><Link className="mk-all-link" href="/industries">Explore all industries →</Link></div></div> : null}
      {mobile ? <nav className="mk-mobile-nav" aria-label="Mobile marketing navigation"><Link href="/product">Product overview</Link><Link href="/invoicing">Invoicing</Link><Link href="/accounting">Accounting</Link><Link href="/ai">RetailBooks AI</Link><Link href="/industries">Industries</Link><Link href="/customers">Customers</Link><Link href="/security">Security</Link><Link href="/contact">Contact</Link><Link className="mk-button" href="/signup">Try it free</Link></nav> : null}
    </header>
  );
}
