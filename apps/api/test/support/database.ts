import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { Client } from 'pg';

/**
 * Locates `apps/api` without `import.meta.url` or `__dirname`: the API compiles to CommonJS, which
 * forbids the former, while the tests run through SWC as ES modules, which lacks the latter.
 *
 * Vitest sets the working directory to the directory of its config, so the common case is a direct
 * hit; running from the repository root is handled as a fallback.
 */
function findApiRoot(): string {
  const candidates = [process.cwd(), resolve(process.cwd(), 'apps/api')];
  const match = candidates.find((candidate) =>
    existsSync(resolve(candidate, 'prisma/schema.prisma')),
  );
  if (!match) {
    throw new Error(
      `Could not locate apps/api from ${process.cwd()}; run the integration suite via npm run test:integration.`,
    );
  }
  return match;
}

export const apiRoot = findApiRoot();
const repoRoot = resolve(apiRoot, '../..');

const DEFAULT_URL = 'postgresql://retailbooks:retailbooks@localhost:55432/retailbooks';
const TEST_DATABASE_NAME = 'retailbooks_test';

/**
 * Loads the same `.env` the API would load, without overriding anything already in the environment.
 * The API resolves `.env` from its own working directory, so prefer `apps/api/.env` and fall back to
 * the repository root.
 */
function loadEnvFiles(): void {
  for (const candidate of [resolve(apiRoot, '.env'), resolve(repoRoot, '.env')]) {
    if (existsSync(candidate)) dotenv.config({ path: candidate, override: false });
  }
}

/** The connection URL for the dedicated test database, derived from the configured base URL. */
export function testDatabaseUrl(): string {
  loadEnvFiles();
  const base = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
  base.pathname = `/${TEST_DATABASE_NAME}`;
  return base.toString();
}

/** The `postgres` maintenance URL on the same server, used to create the test database. */
function maintenanceUrl(): string {
  const base = new URL(testDatabaseUrl());
  base.pathname = '/postgres';
  return base.toString();
}

/**
 * Creates the test database if it does not exist, then brings it up to the current migration head.
 * Safe to call repeatedly; `migrate deploy` is a no-op once every migration is applied.
 */
export async function provisionTestDatabase(): Promise<string> {
  const url = testDatabaseUrl();

  const admin = new Client({ connectionString: maintenanceUrl() });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE_NAME,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
  } finally {
    await admin.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  return url;
}

let cachedTables: string[] | null = null;

/**
 * Empties every application table between tests. `_prisma_migrations` is preserved so the schema
 * does not have to be reapplied. CASCADE handles the foreign-key graph in one statement.
 */
export async function truncateAll(client: {
  $queryRawUnsafe: <T>(sql: string) => Promise<T>;
  $executeRawUnsafe: (sql: string) => Promise<number>;
}): Promise<void> {
  if (!cachedTables) {
    const rows = await client.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    cachedTables = rows.map((row) => `"public"."${row.tablename}"`);
  }

  if (cachedTables.length === 0) return;
  await client.$executeRawUnsafe(
    `TRUNCATE TABLE ${cachedTables.join(', ')} RESTART IDENTITY CASCADE`,
  );
}
