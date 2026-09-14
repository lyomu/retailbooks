import {
  Building2,
  Camera,
  HeartHandshake,
  Palette,
  ShoppingBag,
  Wrench,
} from 'lucide-react';
import { FinalCta, PageHero } from '../../../components/marketing/sections';

const industries = [
  {
    Icon: ShoppingBag,
    title: 'Retail',
    text: 'Keep inventory spending, sales, suppliers, and payments in one clear view.',
    href: '/industries/retail',
  },
  {
    Icon: Wrench,
    title: 'Contractors',
    text: 'Turn estimates into invoices and keep every job moving toward payment.',
    href: '/industries/contractors',
  },
  {
    Icon: Camera,
    title: 'Freelancers',
    text: 'Send polished invoices, track expenses, and know what your work is worth.',
    href: '/industries/freelancers',
  },
  {
    Icon: HeartHandshake,
    title: 'Professional services',
    text: 'Make recurring work, retainers, and client billing feel wonderfully routine.',
    href: '/industries/professional-services',
  },
  {
    Icon: Palette,
    title: 'Creative agencies',
    text: 'Keep projects, collaborators, and cash flow in creative sync.',
    href: '/industries/creative-agencies',
  },
  {
    Icon: Building2,
    title: 'Small businesses',
    text: 'A calmer home for the daily money work that keeps your business healthy.',
    href: '/industries/small-businesses',
  },
];

export default function IndustriesPage() {
  return (
    <>
      <PageHero
        eyebrow="BUILT AROUND REAL WORK"
        title="Your business has a rhythm. Your books should keep up."
        copy="RetailBooks brings invoicing, money tracking, and helpful AI into one friendly system—tailored to the way you actually work."
        action={{ label: 'Start free', href: '/contact' }}
        visual="insights"
      />

      <section className="mk-section mk-section--cream">
        <div className="mk-container">
          <div className="mk-section-heading">
            <span className="mk-eyebrow">CHOOSE YOUR PATH</span>
            <h2>Built for the people behind the business.</h2>
          </div>
          <div className="mk-industry-grid">
            {industries.map(({ Icon, title, text, href }) => (
              <a className="mk-industry-card" href={href} key={title}>
                <span className="mk-icon-tile"><Icon aria-hidden="true" size={25} /></span>
                <h3>{title}</h3>
                <p>{text}</p>
                <span className="mk-text-link">Explore {title}<span aria-hidden="true"> →</span></span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <FinalCta />
    </>
  );
}
