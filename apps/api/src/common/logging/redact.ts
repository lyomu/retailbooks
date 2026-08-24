const SENSITIVE_QUERY_KEYS = new Set(['token', 'code', 'secret', 'password', 'key']);

/**
 * Strips sensitive query-string values from a URL before it reaches a log line.
 *
 * Verification and recovery links carry single-use tokens in the query string, and a logged token is
 * a usable token. Pino's `redact` option only walks object paths, so URL contents need this.
 */
export function redactUrl(url: string): string {
  const separator = url.indexOf('?');
  if (separator === -1) return url;

  const path = url.slice(0, separator);
  const query = new URLSearchParams(url.slice(separator + 1));
  let mutated = false;

  for (const key of [...query.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      query.set(key, '[redacted]');
      mutated = true;
    }
  }

  if (!mutated) return url;
  const rendered = query.toString().replace(/%5Bredacted%5D/g, '[redacted]');
  return `${path}?${rendered}`;
}
