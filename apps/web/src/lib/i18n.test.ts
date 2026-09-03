import { describe, expect, it } from 'vitest';

import { complianceStringKeys, complianceTone, uiStrings } from './i18n';

describe('uiStrings', () => {
  it('resolves the base bundle for a supported locale', () => {
    const { strings, fallbackUsed } = uiStrings('en');
    expect(fallbackUsed).toBe(false);
    expect(strings['settings.compliance.heading']).toBe('Compliance status');
    expect(strings['settings.language.heading']).toBe('Language');
  });

  it('resolves a regional locale to its language bundle without claiming a translation', () => {
    expect(uiStrings('en-KE').fallbackUsed).toBe(false);
  });

  it('reports an honest fallback for locales without a reviewed bundle', () => {
    const { strings, fallbackUsed } = uiStrings('fr-FR');
    expect(fallbackUsed).toBe(true);
    expect(strings['settings.language.fallback']).toContain('Reviewed translations');
  });
});

describe('compliance status strings', () => {
  it('maps every compliance status to a catalog title and description', () => {
    expect(complianceStringKeys('FULLY_REVIEWED')).toEqual({
      title: 'compliance.fullyReviewed.title',
      description: 'compliance.fullyReviewed.description',
    });
    expect(complianceStringKeys('GENERIC_CONFIGURATION')).toEqual({
      title: 'compliance.genericConfiguration.title',
      description: 'compliance.genericConfiguration.description',
    });
    expect(complianceStringKeys('UNSUPPORTED')).toEqual({
      title: 'compliance.unsupported.title',
      description: 'compliance.unsupported.description',
    });
  });

  it('maps tone to the honesty rules', () => {
    expect(complianceTone('FULLY_REVIEWED')).toBe('success');
    expect(complianceTone('GENERIC_CONFIGURATION')).toBe('info');
    expect(complianceTone('UNSUPPORTED')).toBe('danger');
  });

  it('never seeds an unsupported-jurisdiction title with a compliance claim', () => {
    expect(uiStrings('en').strings['compliance.unsupported.title']).toBe(
      'Unsupported jurisdiction',
    );
  });
});
