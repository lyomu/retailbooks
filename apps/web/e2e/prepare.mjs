import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Queue } from 'bullmq';
import pg from 'pg';
import { createClient } from 'redis';

const { Client } = pg;
const DATABASE_NAME = 'retailbooks_e2e';
const DATABASE_URL = `postgresql://retailbooks:retailbooks@localhost:55432/${DATABASE_NAME}`;
const MAINTENANCE_URL = 'postgresql://retailbooks:retailbooks@localhost:55432/postgres';
const QUEUE_PREFIX = 'retailbooks-e2e';
const repoRoot = resolve(process.cwd(), '../..');

await createDatabase();
runNpm(['exec', '--workspace', '@retailbooks/api', '--', 'prisma', 'migrate', 'deploy']);
await resetDatabase();
await clearEmailQueue();
await clearAuthRateLimits();
runNpm(['run', 'db:seed', '--workspace', '@retailbooks/api']);

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
    for await (const key of client.scanIterator({ MATCH: 'auth:*', COUNT: 200 })) {
      await client.del(key);
    }
  } finally {
    await client.quit();
  }
}

function runNpm(args) {
  execFileSync('npm', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL,
      NODE_ENV: 'test',
      QUEUE_PREFIX,
      WEB_APP_URL: 'http://127.0.0.1:3300',
    },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
}
