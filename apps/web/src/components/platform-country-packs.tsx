'use client';

import type {
  PlatformCountryPack,
  PlatformCountryPackTier,
  PlatformTaxPack,
} from '@retailbooks/contracts';
import {
  Archive,
  CirclePlus,
  CopyPlus,
  FileJson,
  LockKeyhole,
  Pencil,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { platformRoleAtLeast, usePlatformSession } from '../lib/platform';
import { PlatformPage } from './platform-shell';

const REQUIRED_DEFAULT_KEYS = [
  'currency',
  'locale',
  'timeZone',
  'fiscalYearStartMonth',
  'fiscalYearStartDay',
  'chartTemplate',
  'journalPrefix',
  'numberPadding',
  'numberingReset',
] as const;

type EditorMode =
  | { kind: 'create'; source?: PlatformCountryPack }
  | { kind: 'pack'; pack: PlatformCountryPack }
  | { kind: 'tax'; pack: PlatformCountryPack; taxPack?: PlatformTaxPack };

type LifecycleAction = 'publish' | 'deprecate' | 'delete';

interface Confirmation {
  action: LifecycleAction;
  pack: PlatformCountryPack;
}

interface DraftForm {
  code: string;
  version: string;
  countryCode: string;
  name: string;
  tier: PlatformCountryPackTier;
  defaults: string;
  notes: string;
  supportedEntityTypes: string;
  includeTax: boolean;
  taxVersion: string;
  taxName: string;
  rates: string;
  registrationFields: string;
  exemptions: string;
  reportingMappings: string;
  taxNotes: string;
}

type JsonObject = Record<string, unknown>;

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseObject(label: string, value: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as JsonObject;
}

function parseObjectArray(label: string, value: string): JsonObject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new Error(`${label} must be a JSON array of objects.`);
  }
  return parsed as JsonObject[];
}

function formFor(mode: EditorMode): DraftForm {
  const pack = mode.kind === 'create' ? mode.source : mode.pack;
  const taxPack =
    mode.kind === 'tax'
      ? mode.taxPack
      : mode.kind === 'create'
        ? mode.source?.taxPacks[0]
        : undefined;
  const creatingVersion = mode.kind === 'create' && Boolean(mode.source);

  return {
    code: pack?.code ?? '',
    version: creatingVersion ? '' : (pack?.version ?? ''),
    countryCode: pack?.countryCode ?? '',
    name: pack?.name ?? '',
    tier: pack?.tier ?? 'TIER_B_GENERIC',
    defaults: prettyJson(pack?.defaults ?? {}),
    notes: pack?.notes.join('\n') ?? '',
    supportedEntityTypes: pack?.supportedEntityTypes.join(', ') ?? '',
    includeTax: mode.kind === 'tax' || Boolean(taxPack),
    taxVersion: creatingVersion ? '' : (taxPack?.version ?? ''),
    taxName: taxPack?.name ?? (pack ? `${pack.name} tax pack` : ''),
    rates: prettyJson(taxPack?.rates ?? []),
    registrationFields: prettyJson(taxPack?.registrationFields ?? []),
    exemptions: prettyJson(taxPack?.exemptions ?? []),
    reportingMappings: prettyJson(taxPack?.reportingMappings ?? {}),
    taxNotes: taxPack?.notes.join('\n') ?? '',
  };
}

function packPath(pack: PlatformCountryPack): string {
  return `/localization/country-packs/${encodeURIComponent(pack.code)}/versions/${encodeURIComponent(pack.version)}`;
}

export function PlatformCountryPacks() {
  const { session } = usePlatformSession();
  const [packs, setPacks] = useState<PlatformCountryPack[] | null>(null);
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = platformRoleAtLeast(session?.role ?? null, 'SUPERADMIN');

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      const response = await apiRequest<{ data: PlatformCountryPack[] }>(
        '/localization/country-packs/admin/all',
      );
      setPacks(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Country packs could not be loaded.');
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      await load();
      setNotice(success);
      return true;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That change could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runLifecycle(confirmationValue: Confirmation) {
    const { action, pack } = confirmationValue;
    const path = action === 'delete' ? packPath(pack) : `${packPath(pack)}/${action}`;
    const success =
      action === 'publish'
        ? `${pack.code} ${pack.version} published.`
        : action === 'deprecate'
          ? `${pack.code} ${pack.version} deprecated.`
          : `${pack.code} ${pack.version} deleted.`;
    if (await mutate(path, action === 'delete' ? 'DELETE' : 'POST', undefined, success)) {
      setConfirmation(null);
      if (editor && 'pack' in editor && editor.pack.id === pack.id) setEditor(null);
    }
  }

  if (!canManage) {
    return (
      <PlatformPage
        title="Country packs and tax definitions"
        description="Versioned jurisdiction defaults and the tax metadata shipped with them."
      >
        <section className="rb-platform__card rb-platform__forbidden">
          <LockKeyhole aria-hidden="true" />
          <div>
            <h2>Superadmin access required</h2>
            <p className="rb-platform__muted">
              Country packs affect every tenant that adopts them. A superadmin must review and
              manage this catalog.
            </p>
          </div>
        </section>
      </PlatformPage>
    );
  }

  return (
    <PlatformPage
      title="Country packs and tax definitions"
      description="Create immutable versions, review jurisdiction defaults, and manage the tax metadata each version carries."
      actions={
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirmation(null);
            setEditor({ kind: 'create' });
          }}
        >
          <CirclePlus aria-hidden="true" />
          New draft
        </button>
      }
    >
      {error ? (
        <p className="rb-platform__alert" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rb-platform__notice" role="status">
          {notice}
        </p>
      ) : null}

      {editor ? (
        <CountryPackEditor
          key={`${editor.kind}-${'pack' in editor ? editor.pack.id : (editor.source?.id ?? 'new')}-${editor.kind === 'tax' ? (editor.taxPack?.id ?? 'new-tax') : ''}`}
          mode={editor}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={async (body, success) => {
            const target =
              editor.kind === 'create' ? '/localization/country-packs' : packPath(editor.pack);
            if (await mutate(target, editor.kind === 'create' ? 'POST' : 'PATCH', body, success)) {
              setEditor(null);
            }
          }}
        />
      ) : null}

      {confirmation ? (
        <LifecycleConfirmation
          confirmation={confirmation}
          busy={busy}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void runLifecycle(confirmation)}
        />
      ) : null}

      {packs === null ? (
        <p className="rb-platform__muted">Loading country packs...</p>
      ) : packs.length === 0 ? (
        <section className="rb-platform__card rb-platform__empty">
          <FileJson aria-hidden="true" />
          <h2>No country packs yet</h2>
          <p className="rb-platform__muted">
            Create a draft to establish the first versioned jurisdiction configuration.
          </p>
        </section>
      ) : (
        <CountryPackTable
          packs={packs}
          busy={busy}
          onEdit={(pack) => {
            setConfirmation(null);
            setEditor({ kind: 'pack', pack });
          }}
          onEditTax={(pack, taxPack) => {
            setConfirmation(null);
            setEditor({ kind: 'tax', pack, taxPack });
          }}
          onCreateVersion={(source) => {
            setConfirmation(null);
            setEditor({ kind: 'create', source });
          }}
          onLifecycle={(action, pack) => {
            setEditor(null);
            setConfirmation({ action, pack });
          }}
        />
      )}
    </PlatformPage>
  );
}

function CountryPackTable({
  packs,
  busy,
  onEdit,
  onEditTax,
  onCreateVersion,
  onLifecycle,
}: {
  packs: PlatformCountryPack[];
  busy: boolean;
  onEdit: (pack: PlatformCountryPack) => void;
  onEditTax: (pack: PlatformCountryPack, taxPack?: PlatformTaxPack) => void;
  onCreateVersion: (pack: PlatformCountryPack) => void;
  onLifecycle: (action: LifecycleAction, pack: PlatformCountryPack) => void;
}) {
  return (
    <div className="rb-platform__table-wrap">
      <table className="rb-platform__table rb-platform__catalog-table">
        <caption className="rb-visually-hidden">Country pack versions and tax definitions</caption>
        <thead>
          <tr>
            <th scope="col">Country pack</th>
            <th scope="col">Version</th>
            <th scope="col">Jurisdiction</th>
            <th scope="col">Tax definitions</th>
            <th scope="col">Updated</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {packs.map((pack) => (
            <tr key={pack.id}>
              <th scope="row">
                {pack.name}
                <small>{pack.code}</small>
              </th>
              <td>
                <strong>{pack.version}</strong>
                <small>
                  <PackStatus status={pack.status} />
                </small>
              </td>
              <td>
                {pack.countryCode}
                <small>{tierLabel(pack.tier)}</small>
              </td>
              <td className="rb-platform__tax-cell">
                {pack.taxPacks.length === 0 ? (
                  <span className="rb-platform__muted">None</span>
                ) : (
                  <ul className="rb-platform__tax-list">
                    {pack.taxPacks.map((taxPack) => (
                      <li key={taxPack.id}>
                        <span>
                          {taxPack.name}
                          <small>
                            {taxPack.version} - {taxPack.rates.length}{' '}
                            {taxPack.rates.length === 1 ? 'rate' : 'rates'}
                          </small>
                        </span>
                        {pack.status === 'DRAFT' ? (
                          <button
                            type="button"
                            className="rb-platform__link is-neutral"
                            disabled={busy}
                            onClick={() => onEditTax(pack, taxPack)}
                          >
                            Edit
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {pack.status === 'DRAFT' ? (
                  <button
                    type="button"
                    className="rb-platform__link is-neutral rb-platform__add-tax"
                    disabled={busy}
                    onClick={() => onEditTax(pack)}
                  >
                    <CirclePlus aria-hidden="true" />
                    Add tax version
                  </button>
                ) : null}
              </td>
              <td>
                {new Date(pack.updatedAt).toLocaleDateString()}
                <small>{new Date(pack.updatedAt).toLocaleTimeString()}</small>
              </td>
              <td>
                <div className="rb-platform__table-actions">
                  {pack.status === 'DRAFT' ? (
                    <>
                      <button
                        type="button"
                        className="is-secondary"
                        disabled={busy}
                        onClick={() => onEdit(pack)}
                      >
                        <Pencil aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onLifecycle('publish', pack)}
                      >
                        <Send aria-hidden="true" />
                        Publish
                      </button>
                      <button
                        type="button"
                        className="is-danger is-quiet-danger"
                        disabled={busy}
                        onClick={() => onLifecycle('delete', pack)}
                      >
                        <Trash2 aria-hidden="true" />
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="is-secondary"
                        disabled={busy}
                        onClick={() => onCreateVersion(pack)}
                      >
                        <CopyPlus aria-hidden="true" />
                        Create version
                      </button>
                      {pack.status === 'PUBLISHED' ? (
                        <button
                          type="button"
                          className="is-secondary"
                          disabled={busy}
                          onClick={() => onLifecycle('deprecate', pack)}
                        >
                          <Archive aria-hidden="true" />
                          Deprecate
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountryPackEditor({
  mode,
  busy,
  onCancel,
  onSave,
}: {
  mode: EditorMode;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>, success: string) => Promise<void>;
}) {
  const [form, setForm] = useState(() => formFor(mode));
  const [formError, setFormError] = useState('');
  const isCreate = mode.kind === 'create';
  const isTaxOnly = mode.kind === 'tax';
  const isVersion = mode.kind === 'create' && Boolean(mode.source);
  const title = isVersion
    ? `Create a version from ${mode.source?.code} ${mode.source?.version}`
    : mode.kind === 'pack'
      ? `Edit ${mode.pack.code} ${mode.pack.version}`
      : mode.kind === 'tax'
        ? `${mode.taxPack ? 'Edit' : 'Add'} tax definition for ${mode.pack.code} ${mode.pack.version}`
        : 'Create country pack draft';

  function update<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setFormError('');
    try {
      const taxPack = form.includeTax
        ? {
            version: form.taxVersion.trim(),
            name: form.taxName.trim(),
            rates: parseObjectArray('Rates', form.rates),
            registrationFields: parseObjectArray('Registration fields', form.registrationFields),
            exemptions: parseObjectArray('Exemptions', form.exemptions),
            reportingMappings: parseObject('Reporting mappings', form.reportingMappings),
            notes: splitList(form.taxNotes),
          }
        : undefined;

      if (form.includeTax && (!taxPack?.version || !taxPack.name)) {
        throw new Error('Tax version and name are required.');
      }

      if (isTaxOnly) {
        await onSave(
          { taxPack },
          `${form.code} ${form.version} tax definition ${form.taxVersion.trim()} saved.`,
        );
        return;
      }

      const defaults = parseObject('Defaults', form.defaults);
      const missing = REQUIRED_DEFAULT_KEYS.filter((key) => !(key in defaults));
      if (missing.length > 0) {
        throw new Error(`Defaults are missing required keys: ${missing.join(', ')}.`);
      }
      if (!form.name.trim()) throw new Error('Pack name is required.');

      if (isCreate) {
        if (!form.code.trim() || !form.version.trim() || !form.countryCode.trim()) {
          throw new Error('Pack code, version, and country code are required.');
        }
        await onSave(
          {
            code: form.code.trim().toUpperCase(),
            version: form.version.trim(),
            countryCode: form.countryCode.trim().toUpperCase(),
            name: form.name.trim(),
            tier: form.tier,
            defaults,
            notes: splitList(form.notes),
            supportedEntityTypes: splitList(form.supportedEntityTypes).map((value) =>
              value.toUpperCase(),
            ),
            ...(taxPack ? { taxPack } : {}),
          },
          `${form.code.trim().toUpperCase()} ${form.version.trim()} draft created.`,
        );
        return;
      }

      await onSave(
        {
          name: form.name.trim(),
          tier: form.tier,
          defaults,
          notes: splitList(form.notes),
          supportedEntityTypes: splitList(form.supportedEntityTypes).map((value) =>
            value.toUpperCase(),
          ),
        },
        `${form.code} ${form.version} updated.`,
      );
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'The form could not be read.');
    }
  }

  return (
    <section className="rb-platform__card rb-platform__editor" aria-labelledby="pack-editor-title">
      <div className="rb-platform__card-head">
        <div>
          <h2 id="pack-editor-title">{title}</h2>
          <p className="rb-platform__muted">
            {isTaxOnly
              ? 'Tax metadata is versioned under this draft. Saving a matching version updates it in place.'
              : 'Published versions stay immutable. Use Create version when live defaults need to change.'}
          </p>
        </div>
        <button
          type="button"
          className="is-secondary rb-platform__close"
          aria-label="Close editor"
          disabled={busy}
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </button>
      </div>

      {formError ? (
        <p className="rb-platform__alert" role="alert">
          {formError}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!isTaxOnly ? (
          <>
            <div className="rb-platform__form-grid">
              <label>
                Pack code
                <input
                  value={form.code}
                  readOnly={isVersion || mode.kind === 'pack'}
                  minLength={2}
                  maxLength={8}
                  placeholder="KE"
                  onChange={(event) =>
                    update('code', event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                />
              </label>
              <label>
                Pack version
                <input
                  value={form.version}
                  readOnly={mode.kind === 'pack'}
                  maxLength={24}
                  placeholder="2026.2"
                  onChange={(event) => update('version', event.target.value)}
                />
              </label>
              <label>
                Country code
                <input
                  value={form.countryCode}
                  readOnly={isVersion || mode.kind === 'pack'}
                  minLength={2}
                  maxLength={2}
                  placeholder="KE"
                  onChange={(event) =>
                    update('countryCode', event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))
                  }
                />
              </label>
              <label>
                Review tier
                <select
                  value={form.tier}
                  onChange={(event) =>
                    update('tier', event.target.value as PlatformCountryPackTier)
                  }
                >
                  <option value="TIER_A_REVIEWED">Tier A - reviewed</option>
                  <option value="TIER_B_GENERIC">Tier B - generic</option>
                  <option value="TIER_C_BLOCKED">Tier C - blocked</option>
                </select>
              </label>
              <label className="rb-platform__field-wide">
                Pack name
                <input
                  value={form.name}
                  minLength={2}
                  maxLength={120}
                  onChange={(event) => update('name', event.target.value)}
                />
              </label>
              <label className="rb-platform__field-wide">
                Supported entity types
                <input
                  value={form.supportedEntityTypes}
                  placeholder="INVOICE, CREDIT_NOTE, BILL, EXPENSE"
                  onChange={(event) => update('supportedEntityTypes', event.target.value)}
                />
              </label>
              <JsonField
                label="Defaults"
                value={form.defaults}
                hint={`Required keys: ${REQUIRED_DEFAULT_KEYS.join(', ')}`}
                onChange={(value) => update('defaults', value)}
              />
              <label className="rb-platform__field-wide">
                Pack notes
                <textarea
                  value={form.notes}
                  rows={3}
                  placeholder="One note per line"
                  onChange={(event) => update('notes', event.target.value)}
                />
              </label>
            </div>

            {isCreate ? (
              <label className="rb-platform__check rb-platform__tax-toggle">
                <input
                  type="checkbox"
                  checked={form.includeTax}
                  onChange={(event) => update('includeTax', event.target.checked)}
                />
                Include a tax definition in this draft
              </label>
            ) : null}
          </>
        ) : null}

        {form.includeTax ? (
          <fieldset className="rb-platform__fieldset">
            <legend>Tax definition</legend>
            <div className="rb-platform__form-grid">
              <label>
                Tax version
                <input
                  value={form.taxVersion}
                  readOnly={mode.kind === 'tax' && Boolean(mode.taxPack)}
                  maxLength={24}
                  placeholder={form.version || '2026.2'}
                  onChange={(event) => update('taxVersion', event.target.value)}
                />
              </label>
              <label>
                Tax definition name
                <input
                  value={form.taxName}
                  minLength={2}
                  maxLength={120}
                  onChange={(event) => update('taxName', event.target.value)}
                />
              </label>
              <JsonField
                label="Rates"
                value={form.rates}
                hint="JSON array of rate objects"
                onChange={(value) => update('rates', value)}
              />
              <JsonField
                label="Registration fields"
                value={form.registrationFields}
                hint="JSON array of field definitions"
                onChange={(value) => update('registrationFields', value)}
              />
              <JsonField
                label="Exemptions"
                value={form.exemptions}
                hint="JSON array of exemption definitions"
                onChange={(value) => update('exemptions', value)}
              />
              <JsonField
                label="Reporting mappings"
                value={form.reportingMappings}
                hint="JSON object keyed by reporting destination"
                onChange={(value) => update('reportingMappings', value)}
              />
              <label className="rb-platform__field-wide">
                Tax notes
                <textarea
                  value={form.taxNotes}
                  rows={3}
                  placeholder="One note per line"
                  onChange={(event) => update('taxNotes', event.target.value)}
                />
              </label>
            </div>
          </fieldset>
        ) : null}

        <div className="rb-platform__actions">
          <button type="submit" disabled={busy}>
            {isCreate ? <CirclePlus aria-hidden="true" /> : <FileJson aria-hidden="true" />}
            {busy ? 'Saving...' : isCreate ? 'Create draft' : 'Save changes'}
          </button>
          <button type="button" className="is-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function JsonField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rb-platform__json-field">
      {label}
      <textarea
        value={value}
        rows={8}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <small>{hint}</small>
    </label>
  );
}

function LifecycleConfirmation({
  confirmation,
  busy,
  onCancel,
  onConfirm,
}: {
  confirmation: Confirmation;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { action, pack } = confirmation;
  const copy =
    action === 'publish'
      ? 'Publishing makes this version available to organizations and permanently locks its contents.'
      : action === 'deprecate'
        ? 'Deprecating removes this version from new selections. Existing pinned organizations and documents remain unchanged.'
        : 'Deleting removes this draft and its tax definitions. Published data is never deleted.';

  return (
    <section className={`rb-platform__confirm ${action === 'delete' ? 'is-danger' : ''}`}>
      <div>
        <h2>
          {action === 'publish' ? 'Publish' : action === 'deprecate' ? 'Deprecate' : 'Delete'}{' '}
          {pack.code} {pack.version}?
        </h2>
        <p>{copy}</p>
      </div>
      <div className="rb-platform__actions">
        <button
          type="button"
          className={action === 'delete' ? 'is-danger' : undefined}
          disabled={busy}
          onClick={onConfirm}
        >
          {action === 'publish' ? <Send aria-hidden="true" /> : null}
          {action === 'deprecate' ? <Archive aria-hidden="true" /> : null}
          {action === 'delete' ? <Trash2 aria-hidden="true" /> : null}
          {busy ? 'Working...' : `Confirm ${action}`}
        </button>
        <button type="button" className="is-secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function PackStatus({ status }: { status: PlatformCountryPack['status'] }) {
  const tone = status === 'PUBLISHED' ? 'is-ok' : status === 'DEPRECATED' ? 'is-warn' : '';
  return <span className={`rb-platform__pill ${tone}`}>{status.toLowerCase()}</span>;
}

function tierLabel(tier: PlatformCountryPackTier): string {
  if (tier === 'TIER_A_REVIEWED') return 'Tier A - reviewed';
  if (tier === 'TIER_C_BLOCKED') return 'Tier C - blocked';
  return 'Tier B - generic';
}
