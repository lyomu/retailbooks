import { ArrowRight, Bot, Check, FileText, LockKeyhole, Quote, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Photo } from './photo';

export { Photo };

export function PageHero({
  eyebrow,
  title,
  copy,
  action,
  visual = 'insights',
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action: { label: string; href: string };
  visual?: 'ai' | 'invoice' | 'insights' | 'people' | 'security';
}) {
  const VisualIcon = visual === 'ai' ? Bot : visual === 'invoice' ? FileText : visual === 'security' ? ShieldCheck : visual === 'people' ? Sparkles : Check;
  return (
    <section className={visual === 'security' ? 'mk-page-hero mk-page-hero--security' : 'mk-page-hero'}>
      <div>
        <p className="mk-kicker">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
        <Link className="mk-button" href={action.href}>{action.label} <ArrowRight /></Link>
      </div>
      <div className="mk-page-hero__visual">
        {visual === 'security' ? (
          <div className="mk-security-orbit"><VisualIcon aria-hidden="true" /><span>Protected access</span><span>Clear controls</span><span>Private by design</span></div>
        ) : (
          <div className="mk-page-hero__symbol"><VisualIcon aria-hidden="true" /><span>{visual === 'ai' ? 'AI-ready workflows' : visual === 'invoice' ? 'Payments made simple' : visual === 'people' ? 'Made for real owners' : 'Clear financial insight'}</span></div>
        )}
      </div>
    </section>
  );
}

export function SectionIntro({ kicker, title, text, centered = false }: { kicker?: string; title: string; text?: string; centered?: boolean }) { return <div className={centered ? 'mk-section-intro is-centered' : 'mk-section-intro'}>{kicker ? <p className="mk-kicker">{kicker}</p> : null}<h2>{title}</h2>{text ? <p>{text}</p> : null}</div>; }
export function FeatureList({ items }: { items: readonly string[] }) { return <ul className="mk-feature-list">{items.map(item => <li key={item}><Check aria-hidden="true" /><span>{item}</span></li>)}</ul>; }
export function StatBand({ items }: { items: { number: string; label: string }[] }) { return <section className="mk-stat-band">{items.map(item => <div key={item.label}><strong>{item.number}</strong><span>{item.label}</span></div>)}</section>; }
const industryPhotos: Record<string, string> = { retail: 'photo-1441986300917-64674bd600d8', ecommerce: 'photo-1472851294608-062f824d29cc', agencies: 'photo-1522071820081-009f0129c71c', restaurants: 'photo-1517248135467-4c7edcad34c4', construction: 'photo-1541888946425-d81bb19240f5', 'professional-services': 'photo-1600880292203-757bb62b4baf' };
export function IndustriesGrid() { const entries: ReadonlyArray<readonly [string, string]> = [['retail','Retail'],['ecommerce','E-commerce'],['agencies','Agencies & consultants'],['restaurants','Restaurants & hospitality'],['construction','Construction & trades'],['professional-services','Professional services']]; return <div className="mk-industries-grid">{entries.map(([slug, title]) => <Link href={`/industries/${slug}`} className="mk-industry-card" key={slug}><Photo id={industryPhotos[slug] ?? ''} alt={`${title} business`} ratio="16 / 9" /><div><h3>{title}</h3><span>Explore solutions <ArrowRight /></span></div></Link>)}</div>; }
const testimonials = [{ text: 'RetailBooks makes it straightforward to move from a busy week to a clear picture of what actually happened.', name: 'Maya K.', role: 'Founder, Studio Mavuno', photo: 'photo-1494790108377-be9c29b29330' }, { text: 'The invoice and expense workflow lets our small team spend far less time chasing admin.', name: 'Eli T.', role: 'Operations lead, Northline', photo: 'photo-1507003211169-0a1dd7228f2d' }, { text: 'I can see what needs attention before it becomes a month-end problem. That changes everything.', name: 'Amara N.', role: 'Owner, The Daily Table', photo: 'photo-1438761681033-6461ffad8d80' }];
export function TestimonialGrid() { return <div className="mk-testimonials">{testimonials.map(item => <figure key={item.name}><Quote aria-hidden="true" /><blockquote>“{item.text}”</blockquote><figcaption><Photo id={item.photo} alt={item.name} ratio="1" width={240} /><span><b>{item.name}</b><small>{item.role}</small></span></figcaption></figure>)}</div>; }
export function SecurityStrip() { return <section className="mk-security-strip"><div><ShieldCheck /><span><b>Your financial data deserves care.</b><small>Encryption in transit and at rest, role-based access, and an auditable trail for key actions.</small></span></div><Link href="/security">See how we protect your data <ArrowRight /></Link></section>; }
export function FinalCta({ title = 'The next clear financial decision starts here.' }: { title?: string }) { return <section className="mk-final-cta"><div><p className="mk-kicker">Make space for better work</p><h2>{title}</h2><p>Bring invoices, expenses, accounting, and AI assistance into one calm workspace.</p></div><div><Link className="mk-button mk-button--light" href="/signup">Try RetailBooks free</Link><Link className="mk-text-link" href="/contact">Talk to our team <ArrowRight /></Link></div></section>; }
export function TrustNote() { return <div className="mk-trust-note"><LockKeyhole aria-hidden="true" /> Your information is handled with responsible safeguards.</div>; }
