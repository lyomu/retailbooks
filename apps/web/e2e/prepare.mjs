import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Queue } from 'bullmq';
import pg from 'pg';
import { createClient } from 'redis';

const { Client } = pg;
const DATABASE_NAME = 'retailbooks_e2e';
const DATABASE_URL = `postgresql://retailbooks:retailbooks@127.0.0.1:55432/${DATABASE_NAME}`;
const MAINTENANCE_URL = 'postgresql://retailbooks:retailbooks@127.0.0.1:55432/postgres';
const QUEUE_PREFIX = 'retailbooks-e2e';
const PLATFORM_ADMIN_EMAIL = 'demo.admin@retailbooks.local';
const repoRoot = resolve(process.cwd(), '../..');

await createDatabase();
runNpm(['exec', '--workspace', '@retailbooks/api', '--', 'prisma', 'migrate', 'deploy']);
await resetDatabase();
await clearEmailQueue();
await clearAuthRateLimits();
runNode([resolve(repoRoot, 'node_modules/@nestjs/cli/bin/nest.js'), 'build'], apiRoot());
runNode(['dist/prisma/seed.js'], apiRoot());
await ensurePlatformAdmin();

async function createDatabase() {
  const admin = new Client({ connectionString: MAINTENANCE_URL });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DATABASE_NAME,
    ]);
    if (existing.rowCount === 0) await admin.query(`CREATE DATABASE "${DATABASE_NAME}"`);
  } finally {
    await admin.end();
  }
}

async function resetDatabase() {
  const database = new Client({ connectionString: DATABASE_URL });
  await database.connect();
  try {
    const result = await database.query(
      `SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables
       FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    const tables = result.rows[0]?.tables;
    if (tables) await database.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    await database.end();
  }
}

async function clearEmailQueue() {
  const queue = new Queue('email-delivery', {
    connection: { host: '127.0.0.1', port: 56379, maxRetriesPerRequest: null },
    prefix: QUEUE_PREFIX,
  });
  try {
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
  }
}

async function clearAuthRateLimits() {
  const client = createClient({ url: 'redis://127.0.0.1:56379' });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({ MATCH: 'auth:*', COUNT: 200 })) {
      // node-redis v5 yields batches; invoking DEL with an empty batch is rejected by Redis.
      const batch = Array.isArray(keys) ? keys : [keys];
      if (batch.length > 0) await client.del(batch);
    }
  } finally {
    await client.quit();
  }
}

/**
 * Browser tests need a database-backed grant before their first navigation. Relying on the
 * allowlist bootstrap would make the non-admin boundary test depend on execution order.
 */
async function ensurePlatformAdmin() {
  const database = new Client({ connectionString: DATABASE_URL });
  await database.connect();
  try {
    await database.query(
      `INSERT INTO platform_admins (user_id, role, status, note)
       SELECT id, 'SUPERADMIN'::"PlatformRole", 'ACTIVE'::"PlatformAdminStatus", $2
       FROM users WHERE email = $1
       ON CONFLICT (user_id) DO UPDATE
       SET role = 'SUPERADMIN'::"PlatformRole", status = 'ACTIVE'::"PlatformAdminStatus",
           revoked_at = NULL, note = EXCLUDED.note`,
      [PLATFORM_ADMIN_EMAIL, 'Deterministic Playwright platform administrator fixture.'],
    );
  } finally {
    await database.end();
  }
}

function runNpm(args) {
  execFileSync('npm', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL,
      REDIS_URL: 'redis://127.0.0.1:56379',
      S3_ENDPOINT: 'http://127.0.0.1:59000',
      SMTP_HOST: '127.0.0.1',
      NODE_ENV: 'test',
      QUEUE_PREFIX,
      WEB_APP_URL: 'http://127.0.0.1:3300',
    },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
}

function runNode(args, cwd) {
  execFileSync(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      DATABASE_URL,
      REDIS_URL: 'redis://127.0.0.1:56379',
      S3_ENDPOINT: 'http://127.0.0.1:59000',
      SMTP_HOST: '127.0.0.1',
      NODE_ENV: 'test',
      QUEUE_PREFIX,
      WEB_APP_URL: 'http://127.0.0.1:3300',
    },
    stdio: 'inherit',
  });
}

function apiRoot() {
  return resolve(repoRoot, 'apps/api');
}
