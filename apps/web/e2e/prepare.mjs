import { execFileSync, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
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

// Mirrors apps/api/src/platform/phase13-feature-flags.ts. Migrations seed these flags as data (see
// add_phase13g_feature_flags), but resetDatabase() below truncates every table including
// feature_flags, so they have to be put back -- the same problem test/support/app.ts's reset()
// solves for the vitest integration harness. Every Phase 13C-13F route 403s without this.
const PHASE13_FEATURE_FLAG_KEYS = [
  'phase13.report_drilldown',
  'phase13.document_extraction',
  'phase13.ai_suggestions',
  'phase13.approval_automation',
  'phase13.advisory_insights.cash_flow',
  'phase13.advisory_insights.collections',
  'phase13.advisory_insights.inventory',
  'phase13.advisory_insights.project_margin',
  'phase13.advisory_insights.policy_qa',
  'phase13.advisory_insights.evidence_packs',
  // phase13.hosted_ai_egress is deliberately excluded: it must stay off (defaultEnabled: false)
  // until the 13A privacy/egress review passes, including in this E2E harness.
];

await createDatabase();
runNpm(['exec', '--workspace', '@retailbooks/api', '--', 'prisma', 'migrate', 'deploy']);
await resetDatabase();
await seedPhase13FeatureFlags();
await clearEmailQueue();
await clearAuthRateLimits();
runNode([resolve(repoRoot, 'node_modules/@nestjs/cli/bin/nest.js'), 'build'], apiRoot());
runNode(['dist/prisma/seed.js'], apiRoot());
await ensurePlatformAdmin();
startDocumentExtractionWorker();

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

async function seedPhase13FeatureFlags() {
  const database = new Client({ connectionString: DATABASE_URL });
  await database.connect();
  try {
    for (const key of PHASE13_FEATURE_FLAG_KEYS) {
      await database.query(
        `INSERT INTO feature_flags (key, name, default_enabled, status)
         VALUES ($1, $1, true, 'ACTIVE')
         ON CONFLICT (key) DO UPDATE SET default_enabled = true, status = 'ACTIVE'`,
        [key],
      );
    }
  } finally {
    await database.end();
  }
}

async function clearEmailQueue() {
  const queue = new Queue('email-delivery', {
    connection: { host: '127.0.0.1', port: 56780, maxRetriesPerRequest: null },
    prefix: QUEUE_PREFIX,
  });
  try {
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
  }
}

async function clearAuthRateLimits() {
  const client = createClient({ url: 'redis://127.0.0.1:56780' });
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
      // schema.prisma's datasource uses `directUrl = env("DATABASE_MIGRATION_URL")` for migration
      // commands (migrate deploy/dev/resolve). Without this, `prisma migrate deploy` below ignores
      // DATABASE_URL entirely and applies against whatever DATABASE_MIGRATION_URL the parent
      // environment (e.g. apps/api/.env) happens to have -- silently migrating the wrong database
      // instead of retailbooks_e2e. This script uses one shared owner-level role for everything, so
      // the migration URL and the runtime URL are the same connection string here.
      DATABASE_MIGRATION_URL: DATABASE_URL,
      REDIS_URL: 'redis://127.0.0.1:56780',
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
      REDIS_URL: 'redis://127.0.0.1:56780',
      S3_ENDPOINT: 'http://127.0.0.1:59000',
      SMTP_HOST: '127.0.0.1',
      NODE_ENV: 'test',
      QUEUE_PREFIX,
      WEB_APP_URL: 'http://127.0.0.1:3300',
    },
    stdio: 'inherit',
  });
}

/**
 * Playwright's `webServer` array only knows how to wait on the API and web servers (they have
 * health-check URLs); the document-extraction BullMQ worker has none, and starting it as a third
 * concurrent `webServer` entry would race the `nest build` above (a worker `command` string can't
 * express "wait for a sibling entry's build step first"). Spawning it here instead, detached and
 * unref'd, guarantees `dist/src/worker.js` already exists (the build above just finished) and lets
 * it keep running for the life of this Playwright run without Playwright needing to manage it.
 * Without this, an uploaded file's `DocumentExtraction` row sits at `PENDING` forever in E2E --
 * see phase13-document-extraction-review.spec.ts, which is the reason this exists.
 */
function startDocumentExtractionWorker() {
  const logFd = openSync(resolve(repoRoot, 'apps/api/e2e-worker.log'), 'a');
  const child = spawn(process.execPath, ['dist/src/worker.js'], {
    cwd: apiRoot(),
    env: {
      ...process.env,
      DATABASE_URL,
      REDIS_URL: 'redis://127.0.0.1:56780',
      S3_ENDPOINT: 'http://127.0.0.1:59000',
      SMTP_HOST: '127.0.0.1',
      NODE_ENV: 'test',
      QUEUE_PREFIX,
      WEB_APP_URL: 'http://127.0.0.1:3300',
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
}

function apiRoot() {
  return resolve(repoRoot, 'apps/api');
}
