import { describe, expect, it } from 'vitest';

import { validateApiEnvironment } from './index';

const productionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@postgres.internal:5432/retailbooks',
  REDIS_URL: 'rediss://redis.internal:6379',
  S3_ENDPOINT: 'https://s3.example.com',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'production-access-key',
  S3_SECRET_KEY: 'production-secret-key',
  S3_BUCKET: 'retailbooks-production',
  SECURITY_PEPPER: 'a-secure-random-pepper-value-with-32-characters',
  WEB_APP_URL: 'https://app.example.com',
  LOG_LEVEL: 'info',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  EMAIL_FROM: 'RetailBooks <no-reply@example.com>',
  QUEUE_PREFIX: 'retailbooks-production',
  API_PORT: '3001',
  EMAIL_JOB_RETRY_DELAY_MS: '1000',
  EMAIL_WORKER_CONCURRENCY: '4',
  AUTOMATION_RETRY_DELAY_MS: '1000',
  AUTOMATION_WORKER_CONCURRENCY: '4',
  AUTOMATION_SCHEDULER_POLL_MS: '30000',
  AUTOMATION_OUTBOX_POLL_MS: '1000',
};

describe('validateApiEnvironment', () => {
  it('supplies local defaults outside production', () => {
    const env = validateApiEnvironment({ NODE_ENV: 'test' });

    expect(env.DATABASE_URL).toBe(
      'postgresql://retailbooks:retailbooks@localhost:55432/retailbooks',
    );
    expect(env.REDIS_URL).toBe('redis://localhost:56379');
    expect(env.S3_BUCKET).toBe('retailbooks-local');
    expect(env.API_PORT).toBe(3001);
  });

  it('fails production boot when required backing services are missing', () => {
    expect(() => validateApiEnvironment({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL is required.*REDIS_URL is required.*S3_ENDPOINT is required/s,
    );
  });

  it('rejects localhost service endpoints in production', () => {
    expect(() =>
      validateApiEnvironment({
        ...productionEnvironment,
        DATABASE_URL: 'postgresql://retailbooks:retailbooks@localhost:55432/retailbooks',
      }),
    ).toThrow(/DATABASE_URL must not point at localhost in production/);
  });

  it('accepts a complete production environment', () => {
    expect(validateApiEnvironment(productionEnvironment)).toMatchObject({
      NODE_ENV: 'production',
      DATABASE_URL: productionEnvironment.DATABASE_URL,
      REDIS_URL: productionEnvironment.REDIS_URL,
      S3_BUCKET: productionEnvironment.S3_BUCKET,
      API_PORT: 3001,
      SMTP_PORT: 587,
    });
  });
});
