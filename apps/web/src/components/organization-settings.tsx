'use client';

import type { OrganizationDetail, OrganizationReferenceData } from '@retailbooks/contracts';
import { Badge, Button, FieldMessage, Input, Label, Select, Skeleton } from '@retailbooks/ui';
import { Save } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { complianceStringKeys, complianceTone, uiStrings } from '../lib/i18n';
import { hasPermission, useWorkspace } from '../lib/workspace';

type DetailResponse = { data: OrganizationDetail };
type ReferenceResponse = { data: OrganizationReferenceData };

export function OrganizationSettings() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organizationId = workspace.activeOrganization?.id ?? null;
  const canUpdate = hasPermission(workspace.activeOrganization, 'organization.update');

  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [reference, setReference] = useState<OrganizationReferenceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [detailResponse, referenceResponse] = await Promise.all([
        apiRequest<DetailResponse>(`/organizations/${organizationId}`),
        apiRequest<ReferenceResponse>('/organizations/reference-data'),
      ]);
      setDetail(detailResponse.data);
      setReference(referenceResponse.data);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Organization settings could not be loaded.',
      );
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSection(section: string, payload: Record<string, unknown>, message: string) {
    if (!organizationId) return;
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<DetailResponse>(`/organizations/${organizationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ section, ...payload }),
      });
      setDetail(response.data);
      setNotice(message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That change could not be saved.');
    }
  }

  if (!detail || !reference) {
    return (
      <div className="rb-security-loading" aria-label="Loading organization settings">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="rb-security-stack">
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rb-auth-notice" role="status">
          {notice}
        </div>
      ) : null}

      <ProfileSection
        detail={detail}
        reference={reference}
        canUpdate={canUpdate}
        onSave={saveSection}
      />
      <JurisdictionSection
        detail={detail}
        reference={reference}
        canUpdate={canUpdate}
        onSave={saveSection}
      />
      <ComplianceSection detail={detail} />
      <AccountingSection
        detail={detail}
        reference={reference}
        canUpdate={canUpdate}
        onSave={saveSection}
      />
      <TaxDefaultsSection
        detail={detail}
        reference={reference}
        canUpdate={canUpdate}
        onSave={saveSection}
      />
    </div>
  );
}

type SectionProps = {
  detail: OrganizationDetail;
  reference: OrganizationReferenceData;
  canUpdate: boolean;
  onSave: (section: string, payload: Record<string, unknown>, message: string) => Promise<void>;
};

function ProfileSection({ detail, reference, canUpdate, onSave }: SectionProps) {
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const tradingName = formValue(data, 'tradingName');
      await onSave(
        'PROFILE',
        {
          legalName: formValue(data, 'legalName'),
          tradingName: tradingName === '' ? null : tradingName,
          businessType: data.get('businessType'),
        },
        'Profile updated.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rb-security-section" aria-labelledby="org-profile-title">
      <div className="rb-security-section__header">
        <div>
          <h2 id="org-profile-title">Profile</h2>
          <p>Legal identity shown across the workspace and on future documents.</p>
        </div>
      </div>
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="org-legal-name">Legal name</Label>
            <Input
              id="org-legal-name"
              name="legalName"
              defaultValue={detail.legalName}
              disabled={!canUpdate}
              required
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="org-trading-name">Trading name</Label>
            <Input
              id="org-trading-name"
              name="tradingName"
              defaultValue={detail.tradingName ?? ''}
              disabled={!canUpdate}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="org-business-type">Business type</Label>
            <Select
              id="org-business-type"
              name="businessType"
              defaultValue={detail.businessType}
              disabled={!canUpdate}
            >
              {reference.businessTypes.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {canUpdate ? (
          <div className="rb-dialog-footer">
            <Button type="submit" loading={saving}>
              <Save aria-hidden="true" /> Save profile
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function JurisdictionSection({ detail, reference, canUpdate, onSave }: SectionProps) {
  const [saving, setSaving] = useState(false);
  const language = uiStrings(detail.locale);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await onSave(
        'JURISDICTION',
        {
          countryCode: data.get('countryCode'),
          baseCurrency: data.get('baseCurrency'),
          timeZone: data.get('timeZone'),
          locale: data.get('locale'),
          fiscalYearStartMonth: Number(data.get('fiscalYearStartMonth')),
          fiscalYearStartDay: Number(data.get('fiscalYearStartDay')),
        },
        'Jurisdiction updated.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rb-security-section" aria-labelledby="org-jurisdiction-title">
      <div className="rb-security-section__header">
        <div>
          <h2 id="org-jurisdiction-title">Jurisdiction</h2>
          <p>Country, currency, time zone, language, and fiscal-year start.</p>
        </div>
      </div>
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="org-country">Country</Label>
            <Select
              id="org-country"
              name="countryCode"
              defaultValue={detail.countryCode}
              disabled={!canUpdate}
            >
              {reference.countries.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="org-currency">Base currency</Label>
            <Select
              id="org-currency"
              name="baseCurrency"
              defaultValue={detail.baseCurrency}
              disabled={!canUpdate}
            >
              {reference.currencies.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.code} — {entry.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="org-timezone">Time zone</Label>
            <Select
              id="org-timezone"
              name="timeZone"
              defaultValue={detail.timeZone}
              disabled={!canUpdate}
            >
              {reference.timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="org-locale">Language</Label>
            <Select
              id="org-locale"
              name="locale"
              defaultValue={detail.locale}
              disabled={!canUpdate}
            >
              {reference.locales.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="org-fiscal-month">Fiscal year start month</Label>
            <Input
              id="org-fiscal-month"
              name="fiscalYearStartMonth"
              type="number"
              min={1}
              max={12}
              defaultValue={detail.fiscalYearStartMonth}
              disabled={!canUpdate}
              required
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="org-fiscal-day">Fiscal year start day</Label>
            <Input
              id="org-fiscal-day"
              name="fiscalYearStartDay"
              type="number"
              min={1}
              max={31}
              defaultValue={detail.fiscalYearStartDay}
              disabled={!canUpdate}
              required
            />
          </div>
        </div>
        {language.fallbackUsed ? (
          <FieldMessage>{language.strings['settings.language.fallback']}</FieldMessage>
        ) : null}
        <FieldMessage>
          Changes apply to fiscal years generated after this change; existing fiscal years and
          periods are not regenerated.
        </FieldMessage>
        {canUpdate ? (
          <div className="rb-dialog-footer">
            <Button type="submit" loading={saving}>
              <Save aria-hidden="true" /> Save jurisdiction
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function ComplianceSection({ detail }: { detail: OrganizationDetail }) {
  const { strings } = uiStrings(detail.locale);
  const compliance = detail.compliance;
  const keys = complianceStringKeys(compliance.status);
  const tone = complianceTone(compliance.status);

  return (
    <section className="rb-security-section" aria-labelledby="org-compliance-title">
      <div className="rb-security-section__header">
        <div>
          <h2 id="org-compliance-title">{strings['settings.compliance.heading']}</h2>
          <p>Taken from the country pack version pinned to this organization.</p>
        </div>
        <Badge tone={tone}>
          <span className="rb-badge__dot" aria-hidden="true" />
          {strings[keys.title]}
        </Badge>
      </div>
      <p className="rb-field-message">{strings[keys.description]}</p>
      <p className="rb-field-message">
        {strings['settings.countryPack.name']}: {compliance.packName ?? '—'} ·{' '}
        {strings['settings.countryPack.code']}: {compliance.packCode ?? '—'} ·{' '}
        {strings['settings.countryPack.version']}: {compliance.packVersion ?? '—'}
      </p>
    </section>
  );
}

function AccountingSection({ detail, reference, canUpdate, onSave }: SectionProps) {
  const [saving, setSaving] = useState(false);
  const preferences = detail.preferences;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const booksStartDate = formValue(data, 'booksStartDate');
      await onSave(
        'ACCOUNTING',
        {
          accountingBasis: data.get('accountingBasis'),
          chartTemplate: data.get('chartTemplate'),
          ...(booksStartDate ? { booksStartDate } : {}),
        },
        'Accounting settings updated.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!preferences) return null;

  return (
    <section className="rb-security-section" aria-labelledby="org-accounting-title">
      <div className="rb-security-section__header">
        <div>
          <h2 id="org-accounting-title">Accounting</h2>
          <p>Accounting basis, starter chart template, and books start date.</p>
        </div>
      </div>
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="org-accounting-basis">Accounting basis</Label>
            <Select
              id="org-accounting-basis"
              name="accountingBasis"
              defaultValue={preferences.accountingBasis}
              disabled={!canUpdate}
            >
              {reference.accountingBases.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="org-chart-template">Starter chart template</Label>
            <Select
              id="org-chart-template"
              name="chartTemplate"
              defaultValue={preferences.chartTemplate}
              disabled={!canUpdate}
            >
              {reference.chartTemplates.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="org-books-start">Books start date</Label>
            <Input
              id="org-books-start"
              name="booksStartDate"
              type="date"
              defaultValue={preferences.booksStartDate ?? ''}
              disabled={!canUpdate}
            />
          </div>
        </div>
        <FieldMessage>
          Changing the chart template does not regenerate accounts already created for this
          organization.
        </FieldMessage>
        {canUpdate ? (
          <div className="rb-dialog-footer">
            <Button type="submit" loading={saving}>
              <Save aria-hidden="true" /> Save accounting
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function TaxDefaultsSection({ detail, reference, canUpdate, onSave }: SectionProps) {
  const [saving, setSaving] = useState(false);
  const [registered, setRegistered] = useState(detail.preferences?.taxRegistered ?? false);
  const preferences = detail.preferences;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const taxIdentifier = formValue(data, 'taxIdentifier');
      await onSave(
        'TAX',
        {
          taxRegistered: registered,
          taxIdentifier: taxIdentifier === '' ? null : taxIdentifier,
          defaultTaxTreatment: data.get('defaultTaxTreatment'),
          defaultTaxRate: Number(data.get('defaultTaxRate')),
        },
        'Tax defaults updated.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!preferences) return null;

  return (
    <section className="rb-security-section" aria-labelledby="org-tax-title">
      <div className="rb-security-section__header">
        <div>
          <h2 id="org-tax-title">Tax defaults</h2>
          <p>
            Defaults for new tax codes and journal lines. Manage individual codes under Tax codes.
          </p>
        </div>
        <Badge tone="info">
          {reference.countries.find((c) => c.code === detail.countryCode)?.taxIdentifierLabel}
        </Badge>
      </div>
      <form className="rb-ledger-form" onSubmit={(event) => void submit(event)}>
        <label className="rb-toggle-row">
          <input
            type="checkbox"
            checked={registered}
            disabled={!canUpdate}
            onChange={(event) => setRegistered(event.target.checked)}
          />
          <span>This organization is tax registered</span>
        </label>
        <div className="rb-field-grid">
          <div className="rb-field">
            <Label htmlFor="org-tax-identifier">Tax identifier</Label>
            <Input
              id="org-tax-identifier"
              name="taxIdentifier"
              defaultValue={preferences.taxIdentifier ?? ''}
              disabled={!canUpdate || !registered}
            />
          </div>
          <div className="rb-field">
            <Label htmlFor="org-tax-treatment">Default treatment</Label>
            <Select
              id="org-tax-treatment"
              name="defaultTaxTreatment"
              defaultValue={preferences.defaultTaxTreatment}
              disabled={!canUpdate}
            >
              {reference.taxTreatments.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="rb-field">
            <Label htmlFor="org-tax-rate">Default rate (%)</Label>
            <Input
              id="org-tax-rate"
              name="defaultTaxRate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={preferences.defaultTaxRate}
              disabled={!canUpdate}
            />
          </div>
        </div>
        {canUpdate ? (
          <div className="rb-dialog-footer">
            <Button type="submit" loading={saving}>
              <Save aria-hidden="true" /> Save tax defaults
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
