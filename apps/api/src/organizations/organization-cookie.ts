import type { Response } from 'express';

/**
 * Remembers which organization the browser last worked in. The cookie is a convenience hint only:
 * membership is re-validated from the authenticated user on every organization-scoped request, so
 * a tampered value can never widen access.
 */
export const ACTIVE_ORGANIZATION_COOKIE = 'rb_org';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function setActiveOrganizationCookie(response: Response, organizationId: string): void {
  response.cookie(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_MS,
  });
}

export function clearActiveOrganizationCookie(response: Response): void {
  response.clearCookie(ACTIVE_ORGANIZATION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}
