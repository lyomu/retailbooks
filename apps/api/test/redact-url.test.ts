import { describe, expect, it } from 'vitest';

import { redactUrl } from '../src/common/logging/redact.js';

describe('redactUrl', () => {
  it('leaves a URL without a query string untouched', () => {
    expect(redactUrl('/api/v1/organizations')).toBe('/api/v1/organizations');
  });

  it('leaves non-sensitive query parameters intact', () => {
    expect(redactUrl('/api/v1/audit-log?limit=50')).toBe('/api/v1/audit-log?limit=50');
  });

  it('redacts a verification token so a log line cannot carry a usable one', () => {
    expect(redactUrl('/verify-email?token=abc123')).toBe('/verify-email?token=[redacted]');
  });

  it('redacts sensitive keys regardless of casing', () => {
    expect(redactUrl('/reset?Token=secret-value')).toBe('/reset?Token=[redacted]');
  });

  it('preserves other parameters while redacting the sensitive one', () => {
    expect(redactUrl('/accept-invitation?token=abc&source=email')).toBe(
      '/accept-invitation?token=[redacted]&source=email',
    );
  });
});
