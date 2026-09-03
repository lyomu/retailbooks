import type { ComplianceStatus } from '@retailbooks/contracts';
import { resolveStrings, type StringKey } from '@retailbooks/localization';

/**
 * Catalog-backed UI strings for the web app. The organization's `locale` drives the resolution;
 * when no reviewed bundle exists for it, the English base bundle is served and `fallbackUsed`
 * tells the UI to say so, rather than pretending the UI is translated.
 */
export interface UiStrings {
  readonly strings: Record<StringKey, string>;
  readonly fallbackUsed: boolean;
}

export function uiStrings(locale: string): UiStrings {
  const resolution = resolveStrings(locale);
  return { strings: resolution.strings, fallbackUsed: resolution.fallbackUsed };
}

const complianceKeyPrefixes: Record<
  ComplianceStatus,
  'fullyReviewed' | 'genericConfiguration' | 'unsupported'
> = {
  FULLY_REVIEWED: 'fullyReviewed',
  GENERIC_CONFIGURATION: 'genericConfiguration',
  UNSUPPORTED: 'unsupported',
};

export type ComplianceTone = 'success' | 'info' | 'danger';

/** Tone matching the honesty rules: reviewed is safe, generic is informational, unsupported is a warning. */
export function complianceTone(status: ComplianceStatus): ComplianceTone {
  return status === 'FULLY_REVIEWED' ? 'success' : status === 'UNSUPPORTED' ? 'danger' : 'info';
}

export function complianceStringKeys(status: ComplianceStatus): {
  readonly title: StringKey;
  readonly description: StringKey;
} {
  const prefix = complianceKeyPrefixes[status];
  return {
    title: `compliance.${prefix}.title`,
    description: `compliance.${prefix}.description`,
  } as const;
}
