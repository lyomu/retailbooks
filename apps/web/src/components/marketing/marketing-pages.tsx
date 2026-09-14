import type { ReactNode } from 'react';
import {
  Bot,
  BookOpen,
  CheckCircle2,
  FileText,
  Landmark,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { AiMockup, DashboardMockup, InvoiceMockup, ReconciliationMockup } from './mockups';
import { FeatureList, FinalCta, PageHero, Photo, SectionIntro } from './sections';

type ProductDetail = {
  kicker: string;
  title: string;
  text: string;
  mockup: ReactNode;
  features: readonly string[];
  photo: string;
};

const productPages = {
  product: {
    kicker: 'ONE CALM PLACE FOR MONEY WORK',
    title: 'A smarter way to run the business behind your business.',
    text: 'RetailBooks brings invoices, bookkeeping, payments, and AI guidance together so the next right move is always close at hand.',
    mockup: <DashboardMockup />,
    features: [
      'A shared home for invoices, expenses, and cash flow',
      'Simple reports that make the numbers understandable',
      'Automations that gently take repetitive work off your plate',
    ],
    photo: 'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=85',
  },
  invoicing: {
    kicker: 'INVOICES THAT DO THE FOLLOW-UP',
    title: 'Get paid without making payment your full-time job.',
    text: 'Create beautiful invoices in minutes, accept secure online payments, and let thoughtful reminders keep things moving.',
    mockup: <InvoiceMockup />,
    features: [
      'Create on-brand invoices, estimates, and deposits',
      'Accept cards and bank payments from the same invoice',
      'Set smart reminders so fewer invoices go quiet',
    ],
    photo: 'https://images.unsplash.com/photo-1556761175-4b46a572b786?auto=format&fit=crop&w=1200&q=85',
  },
  accounting: {
    kicker: 'BOOKS YOU CAN ACTUALLY READ',
    title: 'Know where the money went—and what to do next.',
    text: 'Categorize transactions, understand cash flow, and close the month with a view that feels clear instead of clinical.',
    mockup: <ReconciliationMockup />,
    features: [
      'Bring bank activity, bills, and expenses into one workflow',
      'Track the signals that shape cash flow and profitability',
      'Share organized records with your accountant whenever needed',
    ],
    photo: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=85',
  },
  ai: {
    kicker: 'AI WITH A BUSINESS BRAIN',
    title: 'Meet the assistant that helps you stay ahead.',
    text: 'RetailBooks AI notices patterns, flags follow-ups, and turns financial questions into plain-language next steps—without pretending to replace your judgment.',
    mockup: <AiMockup />,
    features: [
      'Ask practical questions and get answers in plain language',
      'Surface follow-ups, unusual activity, and cash-flow patterns',
      'Automate routine work while keeping you in control',
    ],
    photo: 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1200&q=85',
  },
} satisfies Record<string, ProductDetail>;

type ProductPageKey = keyof typeof productPages;

export function ProductDetailPage({ page }: { page: ProductPageKey }) {
  const data = productPages[page];
  const product = page === 'product';

  return (
    <>
      <PageHero
        eyebrow={data.kicker}
        title={data.title}
        copy={data.text}
        action={{ label: 'Get started free', href: '/contact' }}
        visual={page === 'ai' ? 'ai' : page === 'invoicing' ? 'invoice' : 'insights'}
      />

      <section className="mk-section mk-section--cream">
        <div className="mk-container mk-split">
          <div>
            <span className="mk-eyebrow">THE DETAILS, MADE SIMPLE</span>
            <h2>{product ? 'Everything works better when it works together.' : 'Designed to feel like less work.'}</h2>
            <p className="mk-lead">
              {product
                ? 'Each RetailBooks tool is useful on its own—and even more useful when it shares the same picture of your business.'
                : 'The small, considered details are where RetailBooks earns its keep: fewer tabs, fewer checks, and more confidence in the work.'}
            </p>
            <FeatureList items={data.features} />
          </div>
          <div className="mk-demo-frame">{data.mockup}</div>
        </div>
      </section>

      <section className="mk-section mk-section--blue">
        <div className="mk-container mk-split mk-split--reverse">
          <Photo src={data.photo} alt="Small business owner working with focus" />
          <div>
            <span className="mk-eyebrow">A LITTLE MORE ROOM TO BREATHE</span>
            <h2>Less time untangling the work. More time building the work you love.</h2>
            <p className="mk-lead">
              RetailBooks is made for owners who want a reliable system, not another complicated project. Start with what you need and grow from there.
            </p>
            <Link className="mk-text-link" href="/contact">Talk to our team <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <FinalCta />
    </>
  );
}

export const ProductPage = ProductDetailPage;

const customerStories = [
  {
    name: 'Mina K.',
    role: 'Owner, Morrow Studio',
    quote: 'I used to put off invoices because they always turned into an hour. Now I send them before I make coffee.',
    photo: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=900&q=85',
  },
  {
    name: 'Jordan R.',
    role: 'Founder, Ridgeway Goods',
    quote: 'The dashboard helps me see what matters without making me feel like I need an accounting degree.',
    photo: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=900&q=85',
  },
  {
    name: 'Priya S.',
    role: 'Independent consultant',
    quote: 'The reminders are polite, the reports are clear, and my end-of-month routine finally feels manageable.',
    photo: 'https://images.unsplash.com/photo-1556761175-129418cb2dfe?auto=format&fit=crop&w=900&q=85',
  },
];

export function CustomersPage() {
  return (
    <>
      <PageHero
        eyebrow="THE PEOPLE BEHIND THE NUMBERS"
        title="Built for owners who are busy building something real."
        copy="From the first invoice to the next big decision, RetailBooks gives small businesses a clearer, calmer way forward."
        action={{ label: 'Start your story', href: '/contact' }}
        visual="people"
      />

      <section className="mk-section mk-section--cream">
        <div className="mk-container">
          <SectionIntro kicker="REAL WORK, REAL MOMENTUM" title="Small wins add up." text="Here are a few of the ways teams use RetailBooks to make their day-to-day feel lighter." />
          <div className="mk-story-grid">
            {customerStories.map((story) => (
              <article className="mk-story-card" key={story.name}>
                <Photo src={story.photo} alt="" />
                <blockquote>“{story.quote}”</blockquote>
                <p><strong>{story.name}</strong><br />{story.role}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section--navy">
        <div className="mk-container mk-trust-grid">
          <div><Users aria-hidden="true" /><h3>Made for small teams</h3><p>Helpful from day one, even if you are the whole finance department.</p></div>
          <div><BookOpen aria-hidden="true" /><h3>Clarity you can share</h3><p>Keep your accountant, partner, or team aligned without extra work.</p></div>
          <div><Sparkles aria-hidden="true" /><h3>Progress, not perfection</h3><p>Start simply and add more structure as your business grows.</p></div>
        </div>
      </section>

      <FinalCta />
    </>
  );
}

const securityPoints = [
  { Icon: ShieldCheck, title: 'Security by design', text: 'Thoughtful safeguards, careful access controls, and a privacy-first approach are woven into the product.' },
  { Icon: Landmark, title: 'Your data stays yours', text: 'Your financial records are yours to access, export, and share with the people you choose.' },
  { Icon: CheckCircle2, title: 'Clear, accountable systems', text: 'We build policies and processes that make responsible data handling a daily practice.' },
];

export function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="TRUST IS PART OF THE PRODUCT"
        title="A safer place to run your business."
        copy="Your financial information deserves care. RetailBooks is built to help keep your data protected, understandable, and in your hands."
        action={{ label: 'Contact our team', href: '/contact' }}
        visual="security"
      />

      <section className="mk-section mk-section--cream">
        <div className="mk-container">
          <SectionIntro kicker="A THOUGHTFUL FOUNDATION" title="Security that supports your confidence." text="We pair practical protections with plain language, so you can understand how your information is handled." />
          <div className="mk-security-grid">
            {securityPoints.map(({ Icon, title, text }) => (
              <article className="mk-security-card" key={title}>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section--blue">
        <div className="mk-container mk-split">
          <div className="mk-demo-frame"><DashboardMockup /></div>
          <div>
            <span className="mk-eyebrow">YOU STAY IN CONTROL</span>
            <h2>Clear access. Clear records. Clear choices.</h2>
            <p className="mk-lead">Manage your business with a system that makes sensitive work feel organized and grounded—not mysterious.</p>
            <FeatureList items={['Invite the right people with the right level of access', 'Keep a cleaner record of the work that matters', 'Get help from a real person when you need it']} />
          </div>
        </div>
      </section>

      <FinalCta />
    </>
  );
}

export function getProductPage(page: ProductPageKey) {
  return productPages[page];
}

export const productPageIcons = {
  product: FileText,
  invoicing: FileText,
  accounting: Landmark,
  ai: Bot,
};
