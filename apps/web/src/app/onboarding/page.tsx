import { BookOpenCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { OnboardingWizard } from '../../components/onboarding-wizard';

export const metadata: Metadata = { title: 'Set up your organization | RetailBooks' };

export default function OnboardingPage() {
  return (
    <main className="rb-onboarding-page" id="main-content">
      <header className="rb-onboarding-page__header">
        <Link className="rb-onboarding-page__brand" href="/" aria-label="RetailBooks home">
          <span className="rb-onboarding-page__mark">
            <BookOpenCheck aria-hidden="true" />
          </span>
          <span>
            <strong>RetailBooks</strong>
            <small>Organization setup</small>
          </span>
        </Link>
        <p>Your answers become the accounting foundation for this organization.</p>
      </header>

      <OnboardingWizard />
    </main>
  );
}
