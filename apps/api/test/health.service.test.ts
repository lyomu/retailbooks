import { describe, expect, it } from 'vitest';

import { HealthService } from '../src/health.service';

describe('HealthService', () => {
  it('returns a stable liveness contract', () => {
    const health = new HealthService().liveness();

    expect(health).toMatchObject({
      status: 'ok',
      service: 'retailbooks-api',
      version: '0.1.0',
    });
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });
});
