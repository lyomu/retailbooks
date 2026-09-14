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
  CLAMAV_HOST: 'clamav.internal',
};

describe('validateApiEnvironment', () => {
  it('supplies local defaults outside production', () => {
    const env = validateApiEnvironment({ NODE_ENV: 'test' });

    expect(env.DATABASE_URL).toBe(
      'postgresql://retailbooks_app:retailbooks-app-local@localhost:55432/retailbooks',
    );
    expect(env.REDIS_URL).toBe('redis://localhost:56780');
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

  it('keeps AI disabled unless a private endpoint is explicitly configured', () => {
    expect(validateApiEnvironment({ NODE_ENV: 'test' })).toMatchObject({
      AI_MODE: 'off',
      AI_MAX_CONTEXT_ROWS: 50,
    });

    expect(() => validateApiEnvironment({ NODE_ENV: 'test', AI_MODE: 'private' })).toThrow(
      /AI_PRIVATE_ENDPOINT is required.*AI_PRIVATE_MODEL is required/,
    );
  });

  it('uses a bounded AI retention policy and rejects non-positive retention', () => {
    expect(validateApiEnvironment({ NODE_ENV: 'test' })).toMatchObject({
      AI_RUN_RETENTION_DAYS: 90,
      AI_RETENTION_POLL_MS: 3_600_000,
    });
    expect(() => validateApiEnvironment({ NODE_ENV: 'test', AI_RUN_RETENTION_DAYS: '0' })).toThrow(
      /AI_RUN_RETENTION_DAYS/,
    );
  });

  it('requires an allowlisted HTTPS private endpoint in production', () => {
    expect(() =>
      validateApiEnvironment({
        ...productionEnvironment,
        AI_MODE: 'private',
        AI_PRIVATE_ENDPOINT: 'https://model.internal/v1',
        AI_PRIVATE_MODEL: 'deepseek-local',
      }),
    ).toThrow(/AI_PRIVATE_ALLOWED_HOSTS is required/);

    expect(
      validateApiEnvironment({
        ...productionEnvironment,
        AI_MODE: 'private',
        AI_PRIVATE_ENDPOINT: 'https://model.internal/v1',
        AI_PRIVATE_MODEL: 'deepseek-local',
        AI_PRIVATE_ALLOWED_HOSTS: 'model.internal',
      }),
    ).toMatchObject({ AI_MODE: 'private', AI_PRIVATE_MODEL: 'deepseek-local' });
  });

  it('does not allow the public DeepSeek endpoint to masquerade as private inference', () => {
    expect(() =>
      validateApiEnvironment({
        NODE_ENV: 'test',
        AI_MODE: 'private',
        AI_PRIVATE_ENDPOINT: 'https://api.deepseek.com/v1',
        AI_PRIVATE_MODEL: 'deepseek-chat',
      }),
    ).toThrow(/must not use a hosted DeepSeek endpoint in private mode/);
  });

  it('reports invalid private endpoints as configuration errors', () => {
    expect(() =>
      validateApiEnvironment({
        NODE_ENV: 'test',
        AI_MODE: 'private',
        AI_PRIVATE_ENDPOINT: 'not-a-url',
        AI_PRIVATE_MODEL: 'deepseek-local',
      }),
    ).toThrow(/AI_PRIVATE_ENDPOINT must be a valid http:\/https: URL without credentials/);
  });

  it('requires AI_HOSTED_MODEL when AI_MODE is hosted_limited', () => {
    expect(() =>
      validateApiEnvironment({ NODE_ENV: 'test', AI_MODE: 'hosted_limited' }),
    ).toThrow(/AI_HOSTED_MODEL is required/);

    expect(
      validateApiEnvironment({
        NODE_ENV: 'test',
        AI_MODE: 'hosted_limited',
        AI_HOSTED_MODEL: 'deepseek-chat',
      }),
    ).toMatchObject({ AI_MODE: 'hosted_limited', AI_HOSTED_MODEL: 'deepseek-chat' });
  });

  it('requires AI_HOSTED_API_KEY when AI_MODE is hosted_limited in production', () => {
    expect(() =>
      validateApiEnvironment({
        ...productionEnvironment,
        AI_MODE: 'hosted_limited',
        AI_HOSTED_MODEL: 'deepseek-chat',
      }),
    ).toThrow(/AI_HOSTED_API_KEY is required/);

    expect(
      validateApiEnvironment({
        ...productionEnvironment,
        AI_MODE: 'hosted_limited',
        AI_HOSTED_MODEL: 'deepseek-chat',
        AI_HOSTED_API_KEY: 'hosted-api-key',
      }),
    ).toMatchObject({ AI_MODE: 'hosted_limited', AI_HOSTED_MODEL: 'deepseek-chat' });
  });
});
