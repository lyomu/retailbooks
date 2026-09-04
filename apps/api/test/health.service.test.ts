import { describe, expect, it } from 'vitest';

import { HealthService } from '../src/health.service';

describe('HealthService', () => {
  it('returns a stable liveness contract', () => {
    const health = new HealthService(
      { counts: () => Promise.resolve({ waiting: 0, active: 0, delayed: 0, failed: 0 }) } as never,
      { counts: () => Promise.resolve({ waiting: 0, active: 0, delayed: 0, failed: 0 }) } as never,
      {} as never,
    ).liveness();

    expect(health).toMatchObject({
      status: 'ok',
      service: 'retailbooks-api',
      version: '0.1.0',
    });
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });
});
