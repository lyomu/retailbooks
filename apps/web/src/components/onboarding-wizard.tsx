'use client';

import type {
  OrganizationDetail,
  OrganizationInvitation,
  OrganizationReferenceData,
  OrganizationSummary,
} from '@retailbooks/contracts';
import { Badge, Button, FieldMessage, Input, Label, Select, Skeleton } from '@retailbooks/ui';
import {
  BookOpenCheck,
  Building2,
  Check,
  Globe2,
  Hash,
  Landmark,
  Scale,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { roleLabel } from '../lib/workspace';

type WizardStep =
  'PROFILE' | 'JURISDICTION' | 'ACCOUNTING' | 'TAX' | 'NUMBERING' | 'TEAM' | 'REVIEW';

const STEPS: readonly { key: WizardStep; label: string; hint: string; icon: typeof Building2 }[] = [
  { key: 'PROFILE', label: 'Business', hint: 'Name and legal form', icon: Building2 },
  { key: 'JURISDICTION', label: 'Jurisdiction', hint: 'Country, currency, calendar', icon: Globe2 },
  {
    key: 'ACCOUNTING',
    label: 'Accounting',
    hint: 'Basis and starter accounts',
    icon: BookOpenCheck,
  },
  { key: 'TAX', label: 'Tax', hint: 'Registration and defaults', icon: Landmark },
  { key: 'NUMBERING', label: 'Numbering', hint: 'Document references', icon: Hash },
  { key: 'TEAM', label: 'Team', hint: 'Optional invitations', icon: Users },
  { key: 'REVIEW', label: 'Review', hint: 'Confirm and finish', icon: Scale },
];

const STEP_KEYS = STEPS.map((step) => step.key);

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The API tracks `COMPLETE` too; the wizard resumes a finished draft on its review step. */
function stepFromOnboarding(step: OrganizationDetail['onboardingStep']): WizardStep {
  return step === 'COMPLETE' ? 'REVIEW' : step;
}

export function OnboardingWizard() {
  const router = useRouter();
  const [reference, setReference] = useState<OrganizationReferenceData | null>(null);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [step, setStep] = useState<WizardStep>('PROFILE');
  const [furthestStep, setFurthestStep] = useState<WizardStep>('PROFILE');
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [referenceResponse, listResponse] = await Promise.all([
          apiRequest<{ data: OrganizationReferenceData }>('/organizations/reference-data'),
          apiRequest<{ data: { organizations: OrganizationSummary[] } }>('/organizations'),
        ]);
        setReference(referenceResponse.data);

        const draft = listResponse.data.organizations.find(
          (candidate) => candidate.status === 'DRAFT' && candidate.role === 'OWNER',
        );
        if (draft) {
          const detail = await apiRequest<{ data: OrganizationDetail }>(
            `/organizations/${draft.id}`,
          );
          setOrganization(detail.data);
          const resumed = stepFromOnboarding(detail.data.onboardingStep);
          setStep(resumed);
          setFurthestStep(resumed);
          await loadInvitations(draft.id);
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          router.replace('/login');
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Setup could not be loaded.');
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, []);

  async function loadInvitations(organizationId: string) {
    const response = await apiRequest<{ data: OrganizationInvitation[] }>(
      `/organizations/${organizationId}/invitations`,
    );
    setInvitations(response.data);
  }

  function advance(from: WizardStep) {
    const next = STEP_KEYS[STEP_KEYS.indexOf(from) + 1] ?? 'REVIEW';
    setStep(next);
    setFurthestStep((current) =>
      STEP_KEYS.indexOf(next) > STEP_KEYS.indexOf(current) ? next : current,
    );
  }

  function reportError(caught: unknown) {
    if (caught instanceof ApiError) {
      setError(caught.message);
      setFieldErrors(caught.fieldErrors);
    } else {
      setError('We could not reach RetailBooks. Check your connection and try again.');
    }
  }

  async function saveSection(section: WizardStep, payload: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    setFieldErrors([]);
    try {
      if (!organization) {
        const created = await apiRequest<{ data: OrganizationDetail }>('/organizations', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setOrganization(created.data);
      } else {
        const updated = await apiRequest<{ data: OrganizationDetail }>(
          `/organizations/${organization.id}`,
          { method: 'PATCH', body: JSON.stringify({ section, ...payload }) },
        );
        setOrganization(updated.data);
      }
      advance(section);
    } catch (caught) {
      reportError(caught);
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    if (!organization) return;
    setSaving(true);
    setError(null);
    setFieldErrors([]);
    try {
      await apiRequest(`/organizations/${organization.id}/finalize`, { method: 'POST' });
      router.push('/');
      router.refresh();
    } catch (caught) {
      reportError(caught);
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rb-onboarding-loading" aria-label="Loading organization setup">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  if (!reference) {
    return (
      <div className="rb-auth-error" role="alert">
        {error ?? 'Setup reference data is unavailable.'}
      </div>
    );
  }

  const currentIndex = STEP_KEYS.indexOf(step);
  const reachedIndex = STEP_KEYS.indexOf(furthestStep);

  return (
    <div className="rb-onboarding">
      <nav className="rb-onboarding__steps" aria-label="Setup progress">
        <ol>
          {STEPS.map((entry, index) => {
            const Icon = entry.icon;
            const state =
              index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : '';
            return (
              <li className={state} key={entry.key}>
                <button
                  type="button"
                  onClick={() => setStep(entry.key)}
                  disabled={index > reachedIndex || saving}
                  aria-current={index === currentIndex ? 'step' : undefined}
                >
                  <span className="rb-onboarding__step-icon">
                    {index < currentIndex ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Icon aria-hidden="true" />
                    )}
                  </span>
                  <span className="rb-onboarding__step-copy">
                    <strong>{entry.label}</strong>
                    <small>{entry.hint}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="rb-onboarding__panel" aria-live="polite">
        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        {fieldErrors.length ? (
          <ul className="rb-auth-field-errors" aria-label="Field errors">
            {fieldErrors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}

        {step === 'PROFILE' ? (
          <ProfileStep
            reference={reference}
            organization={organization}
            saving={saving}
            onSubmit={(payload) => void saveSection('PROFILE', payload)}
          />
        ) : null}

        {step === 'JURISDICTION' && organization ? (
          <JurisdictionStep
            reference={reference}
            organization={organization}
            saving={saving}
            onBack={() => setStep('PROFILE')}
            onSubmit={(payload) => void saveSection('JURISDICTION', payload)}
          />
        ) : null}

        {step === 'ACCOUNTING' && organization ? (
          <AccountingStep
            reference={reference}
            organization={organization}
            saving={saving}
            onBack={() => setStep('JURISDICTION')}
            onSubmit={(payload) => void saveSection('ACCOUNTING', payload)}
          />
        ) : null}

        {step === 'TAX' && organization ? (
          <TaxStep
            reference={reference}
            organization={organization}
            saving={saving}
            onBack={() => setStep('ACCOUNTING')}
            onSubmit={(payload) => void saveSection('TAX', payload)}
          />
        ) : null}

        {step === 'NUMBERING' && organization ? (
          <NumberingStep
            reference={reference}
            organization={organization}
            saving={saving}
            onBack={() => setStep('TAX')}
            onSubmit={(payload) => void saveSection('NUMBERING', payload)}
          />
        ) : null}

        {step === 'TEAM' && organization ? (
          <TeamStep
            reference={reference}
            organizationId={organization.id}
            invitations={invitations}
            saving={saving}
            onChanged={() => void loadInvitations(organization.id)}
            onError={reportError}
            onBack={() => setStep('NUMBERING')}
            onContinue={() => void saveSection('TEAM', {})}
          />
        ) : null}

        {step === 'REVIEW' && organization ? (
          <ReviewStep
            reference={reference}
            organization={organization}
            invitations={invitations}
            saving={saving}
            onBack={() => setStep('TEAM')}
            onEdit={setStep}
            onFinalize={() => void finalize()}
          />
        ) : null}
      </section>
    </div>
  );
}

function StepFrame({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <>
      <header className="rb-onboarding__heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
      <div className="rb-onboarding__actions">{footer}</div>
    </>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="rb-field">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <FieldMessage>{hint}</FieldMessage> : null}
    </div>
  );
}

function ProfileStep({
  reference,
  organization,
  saving,
  onSubmit,
}: {
  reference: OrganizationReferenceData;
  organization: OrganizationDetail | null;
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({
      legalName: formValue(data, 'legalName'),
      // `null` clears an existing trading name; the create endpoint treats it as "not supplied".
      tradingName: formValue(data, 'tradingName') || null,
      businessType: data.get('businessType'),
      ...(organization ? {} : { countryCode: data.get('countryCode') }),
    });
  }

  return (
    <form className="rb-onboarding__form" onSubmit={(event) => void submit(event)} noValidate>
      <StepFrame
        title="Tell us about the business"
        description="This is the name that appears on reports and journals. You can change it later in settings."
        footer={
          <Button type="submit" size="lg" loading={saving}>
            {organization ? 'Save and continue' : 'Create organization'}
          </Button>
        }
      >
        <div className="rb-field-grid">
          <Field id="legalName" label="Legal or registered name">
            <Input
              id="legalName"
              name="legalName"
              required
              minLength={2}
              maxLength={180}
              defaultValue={organization?.legalName ?? ''}
              autoComplete="organization"
            />
          </Field>

          <Field
            id="tradingName"
            label="Trading name"
            hint="Optional. Use it when you trade under a different name."
          >
            <Input
              id="tradingName"
              name="tradingName"
              maxLength={180}
              defaultValue={organization?.tradingName ?? ''}
            />
          </Field>

          <Field id="businessType" label="Business type">
            <Select
              id="businessType"
              name="businessType"
              defaultValue={organization?.businessType ?? 'LIMITED_COMPANY'}
            >
              {reference.businessTypes.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>

          {organization ? null : (
            <Field
              id="countryCode"
              label="Country of operation"
              hint="Sets your starting currency, time zone, and fiscal calendar. All remain editable."
            >
              <Select id="countryCode" name="countryCode" defaultValue="KE">
                {reference.countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </StepFrame>
    </form>
  );
}

function JurisdictionStep({
  reference,
  organization,
  saving,
  onBack,
  onSubmit,
}: {
  reference: OrganizationReferenceData;
  organization: OrganizationDetail;
  saving: boolean;
  onBack: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [countryCode, setCountryCode] = useState(organization.countryCode);
  const [baseCurrency, setBaseCurrency] = useState(organization.baseCurrency);
  const [timeZone, setTimeZone] = useState(organization.timeZone);
  const [locale, setLocale] = useState(organization.locale);
  const [month, setMonth] = useState(organization.fiscalYearStartMonth);
  const [day, setDay] = useState(organization.fiscalYearStartDay);

  const maxDay = useMemo(() => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return lengths[month - 1] ?? 31;
  }, [month]);

  /** Choosing a country re-applies that country's defaults; each field stays editable after. */
  function applyCountry(code: string) {
    setCountryCode(code);
    const country = reference.countries.find((candidate) => candidate.code === code);
    if (!country) return;
    setBaseCurrency(country.defaultCurrency);
    setTimeZone(country.defaultTimeZone);
    setLocale(country.defaultLocale);
    setMonth(country.defaultFiscalStartMonth);
    setDay(country.defaultFiscalStartDay);
  }

  return (
    <form
      className="rb-onboarding__form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          countryCode,
          baseCurrency,
          timeZone,
          locale,
          fiscalYearStartMonth: month,
          fiscalYearStartDay: Math.min(day, maxDay),
        });
      }}
      noValidate
    >
      <StepFrame
        title="Where do you keep the books?"
        description="RetailBooks keeps the accounting core global. Country choices supply configurable defaults, not a statutory certification."
        footer={
          <>
            <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
              Back
            </Button>
            <Button type="submit" size="lg" loading={saving}>
              Save and continue
            </Button>
          </>
        }
      >
        <div className="rb-field-grid">
          <Field id="country" label="Country">
            <Select
              id="country"
              value={countryCode}
              onChange={(event) => applyCountry(event.target.value)}
            >
              {reference.countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id="currency"
            label="Base currency"
            hint="Reporting currency for the general ledger."
          >
            <Select
              id="currency"
              value={baseCurrency}
              onChange={(event) => setBaseCurrency(event.target.value)}
            >
              {reference.currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} — {currency.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="timeZone" label="Time zone">
            <Select
              id="timeZone"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
            >
              {reference.timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="locale" label="Language and formatting">
            <Select id="locale" value={locale} onChange={(event) => setLocale(event.target.value)}>
              {reference.locales.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="fiscalMonth" label="Fiscal year starts">
            <Select
              id="fiscalMonth"
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
            >
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>

          <Field id="fiscalDay" label="On day">
            <Select
              id="fiscalDay"
              value={Math.min(day, maxDay)}
              onChange={(event) => setDay(Number(event.target.value))}
            >
              {Array.from({ length: maxDay }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </StepFrame>
    </form>
  );
}

function AccountingStep({
  reference,
  organization,
  saving,
  onBack,
  onSubmit,
}: {
  reference: OrganizationReferenceData;
  organization: OrganizationDetail;
  saving: boolean;
  onBack: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const preferences = organization.preferences;

  return (
    <form
      className="rb-onboarding__form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({
          accountingBasis: data.get('accountingBasis'),
          chartTemplate: data.get('chartTemplate'),
          booksStartDate: formValue(data, 'booksStartDate') || undefined,
        });
      }}
      noValidate
    >
      <StepFrame
        title="How should the ledger behave?"
        description="These defaults shape the starter chart of accounts seeded with your organization. Nothing is posted yet."
        footer={
          <>
            <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
              Back
            </Button>
            <Button type="submit" size="lg" loading={saving}>
              Save and continue
            </Button>
          </>
        }
      >
        <div className="rb-field-grid">
          <Field id="accountingBasis" label="Accounting basis">
            <Select
              id="accountingBasis"
              name="accountingBasis"
              defaultValue={preferences?.accountingBasis ?? 'ACCRUAL'}
            >
              {reference.accountingBases.map((basis) => (
                <option key={basis.code} value={basis.code}>
                  {basis.name} — {basis.description}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id="booksStartDate"
            label="Books start date"
            hint="Optional. The first date you expect to record transactions."
          >
            <Input
              id="booksStartDate"
              name="booksStartDate"
              type="date"
              defaultValue={preferences?.booksStartDate ?? ''}
            />
          </Field>
        </div>

        <fieldset className="rb-choice-set">
          <legend>Starter chart of accounts</legend>
          {reference.chartTemplates.map((template) => (
            <label className="rb-choice" key={template.code}>
              <input
                type="radio"
                name="chartTemplate"
                value={template.code}
                defaultChecked={
                  (preferences?.chartTemplate ?? 'general-business') === template.code
                }
              />
              <span>
                <strong>{template.name}</strong>
                <small>{template.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </StepFrame>
    </form>
  );
}

function TaxStep({
  reference,
  organization,
  saving,
  onBack,
  onSubmit,
}: {
  reference: OrganizationReferenceData;
  organization: OrganizationDetail;
  saving: boolean;
  onBack: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const preferences = organization.preferences;
  const country = reference.countries.find(
    (candidate) => candidate.code === organization.countryCode,
  );
  const [registered, setRegistered] = useState(preferences?.taxRegistered ?? false);

  return (
    <form
      className="rb-onboarding__form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({
          taxRegistered: registered,
          taxIdentifier: registered ? formValue(data, 'taxIdentifier') || null : null,
          defaultTaxTreatment: data.get('defaultTaxTreatment'),
          defaultTaxRate: Number(data.get('defaultTaxRate') ?? 0),
        });
      }}
      noValidate
    >
      <StepFrame
        title="Tax defaults"
        description="Tax codes and effective-dated rates arrive with the tax engine. These defaults simply pre-fill new documents."
        footer={
          <>
            <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
              Back
            </Button>
            <Button type="submit" size="lg" loading={saving}>
              Save and continue
            </Button>
          </>
        }
      >
        <label className="rb-toggle-row">
          <input
            type="checkbox"
            checked={registered}
            onChange={(event) => setRegistered(event.target.checked)}
          />
          <span>
            <strong>This business is registered for sales tax or VAT</strong>
            <small>Turn this on to record a tax identifier and apply tax by default.</small>
          </span>
        </label>

        <div className="rb-field-grid">
          {registered ? (
            <Field id="taxIdentifier" label={country?.taxIdentifierLabel ?? 'Tax identifier'}>
              <Input
                id="taxIdentifier"
                name="taxIdentifier"
                maxLength={60}
                defaultValue={preferences?.taxIdentifier ?? ''}
              />
            </Field>
          ) : null}

          <Field id="defaultTaxTreatment" label="Default treatment on new documents">
            <Select
              id="defaultTaxTreatment"
              name="defaultTaxTreatment"
              defaultValue={preferences?.defaultTaxTreatment ?? 'EXCLUSIVE'}
            >
              {reference.taxTreatments.map((treatment) => (
                <option key={treatment.code} value={treatment.code}>
                  {treatment.name} — {treatment.description}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            id="defaultTaxRate"
            label="Default rate (%)"
            hint={
              country
                ? `A common rate in ${country.name} is ${country.suggestedTaxRate}%. Confirm it with your adviser.`
                : 'Confirm the correct rate with your adviser.'
            }
          >
            <Input
              id="defaultTaxRate"
              name="defaultTaxRate"
              type="number"
              min={0}
              max={100}
              step="0.0001"
              defaultValue={preferences?.defaultTaxRate ?? country?.suggestedTaxRate ?? 0}
            />
          </Field>
        </div>
      </StepFrame>
    </form>
  );
}

function NumberingStep({
  reference,
  organization,
  saving,
  onBack,
  onSubmit,
}: {
  reference: OrganizationReferenceData;
  organization: OrganizationDetail;
  saving: boolean;
  onBack: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const preferences = organization.preferences;
  const [prefix, setPrefix] = useState(preferences?.journalPrefix ?? 'JRN');
  const [padding, setPadding] = useState(preferences?.numberPadding ?? 5);
  const [next, setNext] = useState(preferences?.nextJournalNumber ?? 1);

  const sample = `${prefix || 'JRN'}-${String(next).padStart(padding, '0')}`;

  return (
    <form
      className="rb-onboarding__form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({
          journalPrefix: prefix.toUpperCase(),
          numberPadding: padding,
          nextJournalNumber: next,
          numberingReset: data.get('numberingReset'),
        });
      }}
      noValidate
    >
      <StepFrame
        title="Document numbering"
        description="Journal references are allocated in sequence. Concurrency-safe allocation arrives with the numbering service."
        footer={
          <>
            <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
              Back
            </Button>
            <Button type="submit" size="lg" loading={saving}>
              Save and continue
            </Button>
          </>
        }
      >
        <div className="rb-field-grid">
          <Field
            id="journalPrefix"
            label="Journal prefix"
            hint="Uppercase letters, numbers, and hyphens."
          >
            <Input
              id="journalPrefix"
              value={prefix}
              onChange={(event) => setPrefix(event.target.value.toUpperCase())}
              maxLength={12}
              required
            />
          </Field>

          <Field id="numberPadding" label="Number length">
            <Select
              id="numberPadding"
              value={padding}
              onChange={(event) => setPadding(Number(event.target.value))}
            >
              {[3, 4, 5, 6, 7, 8].map((value) => (
                <option key={value} value={value}>
                  {value} digits
                </option>
              ))}
            </Select>
          </Field>

          <Field id="nextJournalNumber" label="Next number">
            <Input
              id="nextJournalNumber"
              type="number"
              min={1}
              value={next}
              onChange={(event) => setNext(Math.max(1, Number(event.target.value) || 1))}
            />
          </Field>

          <Field id="numberingReset" label="Reset sequence">
            <Select
              id="numberingReset"
              name="numberingReset"
              defaultValue={preferences?.numberingReset ?? 'ANNUAL'}
            >
              {reference.numberingResets.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <p className="rb-onboarding__sample">
          Next journal reference will look like <strong className="rb-num">{sample}</strong>
        </p>
      </StepFrame>
    </form>
  );
}

function TeamStep({
  reference,
  organizationId,
  invitations,
  saving,
  onChanged,
  onError,
  onBack,
  onContinue,
}: {
  reference: OrganizationReferenceData;
  organizationId: string;
  invitations: OrganizationInvitation[];
  saving: boolean;
  onChanged: () => void;
  onError: (caught: unknown) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [inviting, setInviting] = useState(false);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setInviting(true);
    try {
      await apiRequest(`/organizations/${organizationId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          email: formValue(data, 'email').toLowerCase(),
          role: data.get('role'),
        }),
      });
      form.reset();
      onChanged();
    } catch (caught) {
      onError(caught);
    } finally {
      setInviting(false);
    }
  }

  async function revoke(invitationId: string) {
    try {
      await apiRequest(`/organizations/${organizationId}/invitations/${invitationId}`, {
        method: 'DELETE',
      });
      onChanged();
    } catch (caught) {
      onError(caught);
    }
  }

  return (
    <StepFrame
      title="Invite your team"
      description="Optional. Invitations are sent when you finish setup, and each person joins with the role you choose."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
            Back
          </Button>
          <Button type="button" size="lg" onClick={onContinue} loading={saving}>
            {invitations.length > 0 ? 'Save and continue' : 'Skip for now'}
          </Button>
        </>
      }
    >
      <form className="rb-invite-form" onSubmit={(event) => void invite(event)} noValidate>
        <Field id="inviteEmail" label="Email address">
          <Input id="inviteEmail" name="email" type="email" required maxLength={254} />
        </Field>
        <Field id="inviteRole" label="Role">
          <Select id="inviteRole" name="role" defaultValue="ACCOUNTANT">
            {reference.roles
              .filter((role) => role.code !== 'OWNER')
              .map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary" loading={inviting}>
          Add invitation
        </Button>
      </form>

      {invitations.length > 0 ? (
        <ul className="rb-invite-list">
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <div className="rb-invite-list__copy">
                <strong>{invitation.email}</strong>
                <span>
                  {roleLabel(invitation.role)} ·{' '}
                  {invitation.delivered ? 'Invitation sent' : 'Sends when setup finishes'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => void revoke(invitation.id)}
                aria-label={`Remove invitation for ${invitation.email}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rb-onboarding__sample">
          No invitations yet. You can always invite people later from Team &amp; roles.
        </p>
      )}
    </StepFrame>
  );
}

function ReviewStep({
  reference,
  organization,
  invitations,
  saving,
  onBack,
  onEdit,
  onFinalize,
}: {
  reference: OrganizationReferenceData;
  organization: OrganizationDetail;
  invitations: OrganizationInvitation[];
  saving: boolean;
  onBack: () => void;
  onEdit: (step: WizardStep) => void;
  onFinalize: () => void;
}) {
  const preferences = organization.preferences;
  const country = reference.countries.find(
    (candidate) => candidate.code === organization.countryCode,
  );
  const chart = reference.chartTemplates.find(
    (candidate) => candidate.code === preferences?.chartTemplate,
  );
  const monthName = MONTHS[organization.fiscalYearStartMonth - 1] ?? '';

  const groups: { step: WizardStep; title: string; rows: [string, string][] }[] = [
    {
      step: 'PROFILE',
      title: 'Business',
      rows: [
        ['Legal name', organization.legalName],
        ['Trading name', organization.tradingName ?? '—'],
        [
          'Business type',
          reference.businessTypes.find((type) => type.code === organization.businessType)?.name ??
            organization.businessType,
        ],
      ],
    },
    {
      step: 'JURISDICTION',
      title: 'Jurisdiction',
      rows: [
        ['Country', country?.name ?? organization.countryCode],
        ['Base currency', organization.baseCurrency],
        ['Time zone', organization.timeZone.replace(/_/g, ' ')],
        ['Language', organization.locale],
        ['Fiscal year starts', `${monthName} ${organization.fiscalYearStartDay}`],
      ],
    },
    {
      step: 'ACCOUNTING',
      title: 'Accounting',
      rows: [
        ['Basis', preferences?.accountingBasis === 'CASH' ? 'Cash' : 'Accrual'],
        ['Starter accounts', chart?.name ?? '—'],
        ['Books start date', preferences?.booksStartDate ?? 'Not set'],
      ],
    },
    {
      step: 'TAX',
      title: 'Tax',
      rows: [
        ['Registered', preferences?.taxRegistered ? 'Yes' : 'No'],
        ['Identifier', preferences?.taxIdentifier ?? '—'],
        [
          'Default treatment',
          preferences?.defaultTaxTreatment === 'INCLUSIVE' ? 'Tax inclusive' : 'Tax exclusive',
        ],
        ['Default rate', `${preferences?.defaultTaxRate ?? 0}%`],
      ],
    },
    {
      step: 'NUMBERING',
      title: 'Numbering',
      rows: [
        [
          'Next journal reference',
          `${preferences?.journalPrefix ?? 'JRN'}-${String(preferences?.nextJournalNumber ?? 1).padStart(preferences?.numberPadding ?? 5, '0')}`,
        ],
        [
          'Reset',
          reference.numberingResets.find((option) => option.code === preferences?.numberingReset)
            ?.name ?? '—',
        ],
      ],
    },
    {
      step: 'TEAM',
      title: 'Team',
      rows: [
        ['You', 'Owner'],
        [
          'Invitations',
          invitations.length > 0 ? `${invitations.length} pending` : 'None — invite anytime',
        ],
      ],
    },
  ];

  return (
    <StepFrame
      title="Review and finish"
      description="Finishing creates your workspace and its foundation defaults in a single step. Invitations are sent at the same time."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
            Back
          </Button>
          <Button type="button" size="lg" onClick={onFinalize} loading={saving}>
            Finish setup
          </Button>
        </>
      }
    >
      <div className="rb-review-grid">
        {groups.map((group) => (
          <section className="rb-review-card" key={group.step}>
            <header>
              <h3>{group.title}</h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(group.step)}>
                Edit
              </Button>
            </header>
            <dl>
              {group.rows.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <p className="rb-onboarding__note">
        <Badge>Configurable</Badge> Country, tax, and numbering values are software defaults you can
        change at any time. They are not a statement of statutory compliance. See{' '}
        <Link href="/settings/security">account security</Link> for session controls.
      </p>
    </StepFrame>
  );
}
