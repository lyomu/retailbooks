import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FeatureList, FinalCta, StatBand } from '../../../../components/marketing/sections';
import { Photo } from '../../../../components/marketing/photo';

const industries = {
  retail: {
    title: 'Retail accounting that keeps pace with the floor.',
    copy: 'See the movement behind every sale, supplier invoice, and expense without losing time to disconnected admin.',
    photo: 'photo-1441986300917-64674bd600d8',
    features: ['Track expenses and supplier bills in one place', 'See cash movement alongside the day-to-day', 'Keep inventory-aware records ready for review'],
  },
  contractors: {
    title: 'Keep the financial side of every job on solid ground.',
    copy: 'Connect estimates, customer invoices, costs, and approvals so each project has a clearer financial story.',
    photo: 'photo-1541888946425-d81bb19240f5',
    features: ['Move from estimate to invoice without duplicate work', 'Keep job spending visible', 'Follow up on payments without chasing paperwork'],
  },
  freelancers: {
    title: 'More time making the work. Less time chasing the paperwork.',
    copy: 'Keep clients, quotes, invoices, expenses, and reporting aligned from first brief to final payment.',
    photo: 'photo-1494790108377-be9c29b29330',
    features: ['Create polished invoices for every client', 'Track business spending with less effort', 'Know what is due before it becomes a problem'],
  },
  'professional-services': {
    title: 'Professional financial tools for people who work with clients.',
    copy: 'Create a polished client experience while keeping income, expenses, and reporting close at hand.',
    photo: 'photo-1600880292203-757bb62b4baf',
    features: ['Professional invoices and a customer portal', 'Recurring workflows for repeat engagements', 'A clear view of business performance'],
  },
  'creative-agencies': {
    title: 'Keep the creative work moving and the money work in view.',
    copy: 'Bring projects, collaborators, quotes, billing, and cash flow together without draining the energy from the work.',
    photo: 'photo-1522071820081-009f0129c71c',
    features: ['Turn estimates into invoices quickly', 'See costs and client work in the same picture', 'Give the right collaborators the right access'],
  },
  'small-businesses': {
    title: 'A calmer financial home for the business you are building.',
    copy: 'Start with the everyday essentials, then grow into a system that keeps your cash and customer work clearer.',
    photo: 'photo-1556761175-b413da4baf72',
    features: ['Keep invoicing, payments, and expenses together', 'Get a practical view of cash flow', 'Build stronger routines one month at a time'],
  },
} as const;

export function generateStaticParams() {
  return Object.keys(industries).map((slug) => ({ slug }));
}

export default async function IndustryDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = industries[slug as keyof typeof industries];

  if (!data) notFound();

  const label = slug.replaceAll('-', ' ');

  return (
    <>
      <section className="mk-industry-hero">
        <div>
          <p className="mk-kicker">RetailBooks for {label}</p>
          <h1>{data.title}</h1>
          <p>{data.copy}</p>
          <div className="mk-hero-actions">
            <Link className="mk-button" href="/signup">Try it free</Link>
            <Link className="mk-text-link" href="/contact">Talk through your workflow <span aria-hidden="true">→</span></Link>
          </div>
        </div>
        <Photo id={data.photo} alt={label + ' business'} ratio="4 / 3" />
      </section>

      <StatBand items={[
        { number: 'One view', label: 'for cash, customer work, and spending' },
        { number: 'Built-in', label: 'accounting workflow foundations' },
        { number: 'AI-ready', label: 'help when you need the next step' },
        { number: 'Role-aware', label: 'access for the whole team' },
      ]} />

      <section className="mk-industry-detail">
        <div>
          <p className="mk-kicker">A better back office</p>
          <h2>Make the financial details feel like part of the work—not a separate job.</h2>
          <p>RetailBooks gives you a dependable foundation, then keeps the next action within reach.</p>
          <FeatureList items={data.features} />
        </div>
        <div className="mk-industry-detail__card">
          <CheckCircle2 aria-hidden="true" />
          <h3>Built for the practical details</h3>
          <p>Keep financial activity documented, reviewable, and ready for the next decision.</p>
        </div>
      </section>

      <FinalCta title="Give your business a clearer financial home." />
    </>
  );
}
