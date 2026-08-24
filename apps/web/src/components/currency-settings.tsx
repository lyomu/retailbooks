'use client';

import type {
  CurrencyDefinition,
  CurrencySettings as CurrencySettingsData,
  OrganizationCurrency,
} from '@retailbooks/contracts';
import {
  Badge,
  Button,
  CurrencySelect,
  DataTable,
  FieldMessage,
  Input,
  Label,
  Skeleton,
  type DataTableColumn,
} from '@retailbooks/ui';
import { ArrowRightLeft, Check, CircleDollarSign, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import { hasPermission, useWorkspace } from '../lib/workspace';

type SettingsResponse = { data: CurrencySettingsData };
type CatalogResponse = { data: CurrencyDefinition[] };

export function CurrencySettings() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organizationId = workspace.activeOrganization?.id ?? null;
  const canManage = hasPermission(workspace.activeOrganization, 'settings.currency.manage');
  const [settings, setSettings] = useState<CurrencySettingsData | null>(null);
  const [catalog, setCatalog] = useState<CurrencyDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [settingsResponse, catalogResponse] = await Promise.all([
        apiRequest<SettingsResponse>(`/organizations/${organizationId}/currencies`),
        apiRequest<CatalogResponse>('/localization/currencies'),
      ]);
      setSettings(settingsResponse.data);
      setCatalog(catalogResponse.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Currency settings could not be loaded.');
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableToEnable = useMemo(() => {
    const enabledCodes = new Set(
      settings?.currencies.filter((currency) => currency.enabled).map((currency) => currency.code),
    );
    return catalog.filter((currency) => !enabledCodes.has(currency.code));
  }, [catalog, settings]);

  async function mutate(
    operation: string,
    path: string,
    init: RequestInit,
    successMessage: string,
  ) {
    setBusy(operation);
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<SettingsResponse>(path, init);
      setSettings(response.data);
      setNotice(successMessage);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'That currency change could not be saved.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function enableCurrency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const currencyCode = formValue(data, 'currencyCode');
    await mutate(
      `enable-${currencyCode}`,
      `/organizations/${organizationId}/currencies`,
      { method: 'POST', body: JSON.stringify({ currencyCode }) },
      `${currencyCode} enabled.`,
    );
  }

  async function toggleCurrency(currency: OrganizationCurrency) {
    if (!organizationId) return;
    await mutate(
      `toggle-${currency.code}`,
      `/organizations/${organizationId}/currencies/${currency.code}`,
      { method: 'PATCH', body: JSON.stringify({ enabled: !currency.enabled }) },
      `${currency.code} ${currency.enabled ? 'disabled' : 'enabled'}.`,
    );
  }

  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const data = new FormData(event.currentTarget);
    const quoteCurrency = formValue(data, 'quoteCurrency');
    await mutate(
      `rate-${quoteCurrency}`,
      `/organizations/${organizationId}/currencies/exchange-rates`,
      {
        method: 'POST',
        body: JSON.stringify({
          quoteCurrency,
          rate: formValue(data, 'rate'),
          rateDate: formValue(data, 'rateDate'),
          source: 'MANUAL',
        }),
      },
      `${quoteCurrency} rate saved.`,
    );
  }

  if (!settings) {
    return (
      <div className="rb-security-loading" aria-label="Loading currency settings">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  const enabledQuotes = settings.currencies.filter(
    (currency) => currency.enabled && !currency.isBase,
  );
  const currencyRows = settings.currencies.map((currency) => ({ ...currency, id: currency.code }));
  const currencyColumns: readonly DataTableColumn<(typeof currencyRows)[number]>[] = [
    {
      key: 'currency',
      header: 'Currency',
      cell: (currency) => (
        <span className="rb-currency-name">
          <span className="rb-currency-mark" aria-hidden="true">
            {currency.symbol}
          </span>
          <span>
            <strong>{currency.code}</strong>
            <small>{currency.name}</small>
          </span>
        </span>
      ),
    },
    {
      key: 'precision',
      header: 'Precision',
      hideBelow: 'tablet',
      cell: (currency) =>
        currency.minorUnits === 0 ? 'Whole units' : `${currency.minorUnits} decimal places`,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (currency) =>
        currency.isBase ? (
          <Badge tone="info">
            <Check aria-hidden="true" /> Base currency
          </Badge>
        ) : (
          <Badge tone={currency.enabled ? 'success' : 'neutral'}>
            {currency.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        ),
    },
    {
      key: 'action',
      header: <span className="rb-visually-hidden">Actions</span>,
      align: 'right',
      cell: (currency) =>
        canManage && !currency.isBase ? (
          <Button
            variant="ghost"
            size="sm"
            loading={busy === `toggle-${currency.code}`}
            onClick={() => void toggleCurrency(currency)}
          >
            {currency.enabled ? 'Disable' : 'Enable'}
          </Button>
        ) : null,
    },
  ];
  const rateRows = settings.exchangeRates.map((rate) => ({ ...rate, id: rate.id }));
  const rateColumns: readonly DataTableColumn<(typeof rateRows)[number]>[] = [
    {
      key: 'pair',
      header: 'Pair',
      cell: (rate) => (
        <span>
          <strong>{rate.baseCurrency}</strong> / {rate.quoteCurrency}
          <small className="rb-table-secondary">{rate.quoteCurrencyName}</small>
        </span>
      ),
    },
    {
      key: 'rate',
      header: `Rate in ${settings.baseCurrency}`,
      align: 'right',
      cell: (rate) => rate.rate,
    },
    {
      key: 'date',
      header: 'Effective date',
      cell: (rate) => rate.rateDate,
    },
    {
      key: 'source',
      header: 'Source',
      hideBelow: 'tablet',
      cell: (rate) => <Badge>{rate.source}</Badge>,
    },
  ];

  return (
    <div className="rb-currency-stack">
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

      <section className="rb-currency-hero" aria-labelledby="currency-base-title">
        <span className="rb-currency-hero__icon" aria-hidden="true">
          <CircleDollarSign />
        </span>
        <div>
          <p>Reporting currency</p>
          <h2 id="currency-base-title">{settings.baseCurrency}</h2>
          <span>
            Posted journals, trial balances, and reports stay anchored to this currency. It becomes
            protected as soon as accounting activity posts.
          </span>
        </div>
      </section>

      <section className="rb-currency-section" aria-labelledby="enabled-currencies-title">
        <div className="rb-currency-section__heading">
          <div>
            <h2 id="enabled-currencies-title">Enabled currencies</h2>
            <p>Choose which transaction currencies can be used by this organization.</p>
          </div>
          {canManage && availableToEnable.length > 0 ? (
            <form className="rb-currency-enable" onSubmit={(event) => void enableCurrency(event)}>
              <Label className="rb-visually-hidden" htmlFor="enable-currency">
                Currency to enable
              </Label>
              <CurrencySelect
                id="enable-currency"
                name="currencyCode"
                currencies={availableToEnable}
                required
              />
              <Button type="submit" loading={busy?.startsWith('enable-') ?? false}>
                <Plus aria-hidden="true" /> Enable currency
              </Button>
            </form>
          ) : null}
        </div>
        <DataTable
          caption="Organization currencies"
          columns={currencyColumns}
          rows={currencyRows}
          emptyTitle="No currencies configured"
          emptyDescription="Enable a currency to begin recording exchange rates."
        />
      </section>

      <section className="rb-currency-section" aria-labelledby="exchange-rates-title">
        <div className="rb-currency-section__heading">
          <div>
            <h2 id="exchange-rates-title">Exchange rates</h2>
            <p>Rates are effective-dated and snapshotted when a foreign journal posts.</p>
          </div>
        </div>
        {canManage && enabledQuotes.length > 0 ? (
          <form className="rb-rate-form" onSubmit={(event) => void saveRate(event)}>
            <div className="rb-field">
              <Label htmlFor="rate-currency">Transaction currency</Label>
              <CurrencySelect
                id="rate-currency"
                name="quoteCurrency"
                currencies={enabledQuotes}
                required
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="rate-value">{settings.baseCurrency} per 1 unit</Label>
              <Input
                id="rate-value"
                name="rate"
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,10})?"
                placeholder="129.5000"
                required
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="rate-date">Effective date</Label>
              <Input id="rate-date" name="rateDate" type="date" required />
            </div>
            <Button type="submit" loading={busy?.startsWith('rate-') ?? false}>
              <ArrowRightLeft aria-hidden="true" /> Save rate
            </Button>
            <FieldMessage>
              Example: 129.5 means one unit of the transaction currency equals 129.5{' '}
              {settings.baseCurrency}.
            </FieldMessage>
          </form>
        ) : enabledQuotes.length === 0 ? (
          <p className="rb-currency-guidance">Enable a non-base currency before adding a rate.</p>
        ) : null}
        <DataTable
          caption="Effective exchange rates"
          columns={rateColumns}
          rows={rateRows}
          emptyTitle="No exchange rates yet"
          emptyDescription="Save the first effective-dated rate for an enabled currency."
        />
      </section>
    </div>
  );
}
