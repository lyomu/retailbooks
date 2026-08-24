import type { Request } from 'express';

import { hashIdentifier } from './auth.crypto.js';

export interface RequestMetadata {
  ipHash: string;
  userAgent: string | null;
}

export function requestMetadata(request: Request, pepper: string): RequestMetadata {
  const forwarded = request.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? (forwarded[0] ?? request.ip ?? 'unknown')
    : (forwarded?.split(',')[0]?.trim() ?? request.ip ?? 'unknown');

  return {
    ipHash: hashIdentifier(ip, pepper),
    userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
  };
}

export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }

  return null;
}
