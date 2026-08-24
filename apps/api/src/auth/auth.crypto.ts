import { createHash, randomBytes } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';

const PASSWORD_OPTIONS = {
  algorithm: 2, // Argon2id; numeric value avoids ambient const-enum issues with isolated modules.
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashIdentifier(value: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${value}`).digest('hex');
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
