import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API, createTestHarness, type TestHarness } from './support/app.js';
import { migrationCount } from './support/database.js';

describe('integration harness', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it('serves the real application under the production api/v1 prefix', async () => {
    const response = await harness.http().get(`${API}/health`).expect(200);

    expect(response.body).toMatchObject({ status: 'ok', service: 'retailbooks-api' });
  });

  it('reports the test database as reachable', async () => {
    const response = await harness.http().get(`${API}/health/ready`).expect(200);

    const postgres = (
      response.body as { dependencies: { name: string; status: string }[] }
    ).dependencies.find((dependency) => dependency.name === 'postgres');

    expect(postgres?.status).toBe('up');
  });

  it('is connected to the dedicated test database, not the development one', async () => {
    const [row] = await harness.prisma.$queryRaw<{ current_database: string }[]>`
      SELECT current_database()
    `;

    expect(row?.current_database).toBe('retailbooks_test');
  });

  it('applies the full migration history to the test database', async () => {
    const rows = await harness.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;

    expect(Number(rows[0]?.count ?? 0)).toBe(migrationCount());
  });

  it('applies the production validation pipe, rejecting unknown fields', async () => {
    await harness
      .http()
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@example.com', password: 'irrelevant', unexpected: 'field' })
      .expect(400);
  });

  it('truncates application data between tests but keeps the schema', async () => {
    await harness.prisma.user.create({
      data: { email: 'harness@example.com', displayName: 'Harness' },
    });
    expect(await harness.prisma.user.count()).toBe(1);

    await harness.reset();

    expect(await harness.prisma.user.count()).toBe(0);
    const migrations = await harness.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM _prisma_migrations
    `;
    expect(Number(migrations[0]?.count ?? 0)).toBe(migrationCount());
  });
});
