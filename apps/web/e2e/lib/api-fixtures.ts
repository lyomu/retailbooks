import type { APIResponse, Page } from '@playwright/test';

/**
 * Direct API-seeding helpers for E2E preconditions the demo seed data doesn't cover (bank
 * transactions, approval requests, AI suggestions, document extractions). The web app's own
 * `apiRequest` (apps/web/src/lib/api.ts) already calls this same origin with `credentials:
 * 'include'`, so after a real UI sign-in, `page.request` shares the same session cookie -- these
 * calls exercise the real backend services, not a mock, the same way a human clicking through many
 * more screens would.
 */
const API_BASE = 'http://127.0.0.1:3401/api/v1';

async function parseOrThrow<T>(response: APIResponse, method: string, path: string): Promise<T> {
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`${method} ${path} failed: ${response.status()} ${body}`);
  }
  if (response.status() === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API_BASE}${path}`);
  return parseOrThrow<T>(response, 'GET', path);
}

export async function apiPost<T>(page: Page, path: string, body?: unknown): Promise<T> {
  const response = await page.request.post(`${API_BASE}${path}`, {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });
  return parseOrThrow<T>(response, 'POST', path);
}

export async function apiPatch<T>(page: Page, path: string, body: unknown): Promise<T> {
  const response = await page.request.patch(`${API_BASE}${path}`, {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });
  return parseOrThrow<T>(response, 'PATCH', path);
}

export async function apiUploadFile<T>(
  page: Page,
  path: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
  fields: Record<string, string> = {},
): Promise<T> {
  const response = await page.request.post(`${API_BASE}${path}`, {
    multipart: { file: { name: filename, mimeType, buffer }, ...fields },
  });
  return parseOrThrow<T>(response, 'POST', path);
}

export async function getActiveOrganizationId(page: Page): Promise<string> {
  return (await getActiveOrganization(page)).id;
}

export async function getActiveOrganization(
  page: Page,
): Promise<{ id: string; baseCurrency: string }> {
  const result = await apiGet<{
    data: {
      activeOrganizationId: string | null;
      organizations: { id: string; baseCurrency: string }[];
    };
  }>(page, '/organizations');
  const organization = result.data.organizations.find(
    (candidate) => candidate.id === result.data.activeOrganizationId,
  );
  if (!organization) throw new Error('The signed-in user has no active organization.');
  return organization;
}

/** Looks up a chart-of-accounts row by its exact starter-chart name (see
 * apps/api/src/organizations/ledger-starter-chart.ts) -- stable enough to rely on since it seeds
 * identically for every fresh organization. */
export async function findAccountIdByName(
  page: Page,
  organizationId: string,
  name: string,
): Promise<string> {
  const result = await apiGet<{ data: { id: string; name: string }[] }>(
    page,
    `/organizations/${organizationId}/accounts`,
  );
  const account = result.data.find((candidate) => candidate.name === name);
  if (!account) throw new Error(`Account "${name}" was not found in the chart of accounts.`);
  return account.id;
}
