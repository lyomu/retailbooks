import { z } from 'zod';

const LOCAL_DEFAULTS = {
  DATABASE_URL: 'postgresql://retailbooks_app:retailbooks-app-local@localhost:55432/retailbooks',
  REDIS_URL: 'redis://localhost:56780',
  S3_ENDPOINT: 'http://localhost:59000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'retailbooks',
  S3_SECRET_KEY: 'retailbooks-local',
  S3_BUCKET: 'retailbooks-local',
  SECURITY_PEPPER: 'local-development-pepper-change-me',
  WEB_APP_URL: 'http://localhost:3000',
  LOG_LEVEL: 'debug',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '51025',
  EMAIL_FROM: 'RetailBooks <no-reply@retailbooks.local>',
  CLAMAV_HOST: 'localhost',
} as const;

const COMMON_DEFAULTS = {
  API_PORT: '3001',
  QUEUE_PREFIX: 'retailbooks',
  LOG_LEVEL: 'info',
  SMTP_PORT: '587',
  EMAIL_JOB_RETRY_DELAY_MS: '1000',
  EMAIL_WORKER_CONCURRENCY: '4',
  AUTOMATION_RETRY_DELAY_MS: '1000',
  AUTOMATION_WORKER_CONCURRENCY: '4',
  AUTOMATION_SCHEDULER_POLL_MS: '30000',
  AUTOMATION_OUTBOX_POLL_MS: '1000',
  AI_MODE: 'off',
  AI_REQUEST_TIMEOUT_MS: '15000',
  AI_MAX_CONTEXT_ROWS: '50',
  AI_MAX_RETRIES: '1',
  AI_CIRCUIT_FAILURE_THRESHOLD: '3',
  AI_CIRCUIT_OPEN_MS: '30000',
  AI_REQUEST_LIMIT_PER_HOUR: '30',
  AI_ORGANIZATION_REQUEST_LIMIT_PER_HOUR: '100',
  AI_RUN_RETENTION_DAYS: '90',
  AI_RETENTION_POLL_MS: '3600000',
  CLAMAV_PORT: '53310',
  CLAMAV_TIMEOUT_MS: '15000',
  OCR_TIMEOUT_MS: '20000',
  OCR_MAX_TEXT_CHARS: '20000',
  DOCUMENT_EXTRACTION_WORKER_CONCURRENCY: '2',
  DOCUMENT_EXTRACTION_RETRY_DELAY_MS: '2000',
} as const;

const PRODUCTION_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const HOSTED_DEEPSEEK_HOSTS = new Set(['api.deepseek.com']);
const DEFAULT_SECURITY_PEPPERS = new Set([
  LOCAL_DEFAULTS.SECURITY_PEPPER,
  'retailbooks-local-development-pepper-please-change',
  'replace-with-at-least-32-random-characters',
]);

const nodeEnvSchema = z.preprocess(
  emptyStringToUndefined,
  z.enum(['development', 'test', 'production']).default('development'),
);

const nonEmptyString = z.preprocess(
  emptyStringToUndefined,
  z.string({ error: 'is required' }).trim().min(1, 'is required'),
);

const optionalNonEmptyString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);

const portNumber = z.preprocess(
  stringToNumber,
  z.number({ error: 'must be a number' }).int().min(1).max(65_535),
);

const positiveInteger = z.preprocess(
  stringToNumber,
  z.number({ error: 'must be a number' }).int().positive(),
);

const booleanText = z.enum(['true', 'false']).optional();

const aiMode = z.enum(['off', 'private', 'hosted_limited']);

const apiEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    API_PORT: portNumber,
    DATABASE_URL: connectionUrl(['postgres:', 'postgresql:']),
    REDIS_URL: connectionUrl(['redis:', 'rediss:']),
    S3_ENDPOINT: connectionUrl(['http:', 'https:']),
    S3_REGION: nonEmptyString,
    S3_ACCESS_KEY: nonEmptyString,
    S3_SECRET_KEY: nonEmptyString,
    S3_BUCKET: nonEmptyString,
    SECURITY_PEPPER: nonEmptyString,
    WEB_APP_URL: connectionUrl(['http:', 'https:']),
    QUEUE_PREFIX: nonEmptyString,
    LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']),
    SMTP_HOST: nonEmptyString,
    SMTP_PORT: portNumber,
    EMAIL_FROM: nonEmptyString,
    EMAIL_JOB_RETRY_DELAY_MS: positiveInteger,
    EMAIL_WORKER_CONCURRENCY: positiveInteger,
    AUTOMATION_RETRY_DELAY_MS: positiveInteger,
    AUTOMATION_WORKER_CONCURRENCY: positiveInteger,
    AUTOMATION_SCHEDULER_POLL_MS: positiveInteger,
    AUTOMATION_OUTBOX_POLL_MS: positiveInteger,
    AI_MODE: aiMode,
    AI_PRIVATE_ENDPOINT: optionalConnectionUrl(['http:', 'https:']),
    AI_PRIVATE_MODEL: optionalNonEmptyString,
    AI_PRIVATE_API_KEY: optionalNonEmptyString,
    AI_PRIVATE_ALLOWED_HOSTS: optionalNonEmptyString,
    AI_HOSTED_MODEL: optionalNonEmptyString,
    AI_HOSTED_API_KEY: optionalNonEmptyString,
    AI_REQUEST_TIMEOUT_MS: z.preprocess(stringToNumber, z.number().int().min(1_000).max(60_000)),
    AI_MAX_CONTEXT_ROWS: z.preprocess(stringToNumber, z.number().int().min(1).max(100)),
    AI_MAX_RETRIES: z.preprocess(stringToNumber, z.number().int().min(0).max(2)),
    AI_CIRCUIT_FAILURE_THRESHOLD: z.preprocess(stringToNumber, z.number().int().min(1).max(10)),
    AI_CIRCUIT_OPEN_MS: z.preprocess(stringToNumber, z.number().int().min(1_000).max(300_000)),
    AI_REQUEST_LIMIT_PER_HOUR: z.preprocess(stringToNumber, z.number().int().min(1).max(1_000)),
    AI_ORGANIZATION_REQUEST_LIMIT_PER_HOUR: z.preprocess(
      stringToNumber,
      z.number().int().min(1).max(10_000),
    ),
    AI_RUN_RETENTION_DAYS: z.preprocess(stringToNumber, z.number().int().min(1).max(3_650)),
    AI_RETENTION_POLL_MS: z.preprocess(
      stringToNumber,
      z.number().int().min(60_000).max(86_400_000),
    ),
    PLATFORM_ADMIN_EMAILS: optionalNonEmptyString,
    ALLOW_DEMO_SEED: booleanText,
    CLAMAV_HOST: nonEmptyString,
    CLAMAV_PORT: portNumber,
    CLAMAV_TIMEOUT_MS: z.preprocess(stringToNumber, z.number().int().min(1_000).max(60_000)),
    OCR_TIMEOUT_MS: z.preprocess(stringToNumber, z.number().int().min(1_000).max(120_000)),
    OCR_MAX_TEXT_CHARS: z.preprocess(stringToNumber, z.number().int().min(500).max(200_000)),
    DOCUMENT_EXTRACTION_WORKER_CONCURRENCY: positiveInteger,
    DOCUMENT_EXTRACTION_RETRY_DELAY_MS: positiveInteger,
  })
  .superRefine((value, context) => {
    const privateEndpoint = urlOrNull(value.AI_PRIVATE_ENDPOINT);
    if (value.AI_MODE === 'private') {
      if (!value.AI_PRIVATE_ENDPOINT) {
        context.addIssue({
          code: 'custom',
          path: ['AI_PRIVATE_ENDPOINT'],
          message: 'is required when AI_MODE is private',
        });
      }
      if (!value.AI_PRIVATE_MODEL) {
        context.addIssue({
          code: 'custom',
          path: ['AI_PRIVATE_MODEL'],
          message: 'is required when AI_MODE is private',
        });
      }
      if (privateEndpoint && HOSTED_DEEPSEEK_HOSTS.has(privateEndpoint.hostname.toLowerCase())) {
        context.addIssue({
          code: 'custom',
          path: ['AI_PRIVATE_ENDPOINT'],
          message: 'must not use a hosted DeepSeek endpoint in private mode',
        });
      }
    }

    if (value.AI_MODE === 'hosted_limited' && !value.AI_HOSTED_MODEL) {
      context.addIssue({
        code: 'custom',
        path: ['AI_HOSTED_MODEL'],
        message: 'is required when AI_MODE is hosted_limited',
      });
    }

    if (value.NODE_ENV !== 'production') return;

    if (value.SECURITY_PEPPER.length < 32) {
      context.addIssue({
        code: 'custom',
        path: ['SECURITY_PEPPER'],
        message: 'must contain at least 32 characters in production',
      });
    }
    if (DEFAULT_SECURITY_PEPPERS.has(value.SECURITY_PEPPER)) {
      context.addIssue({
        code: 'custom',
        path: ['SECURITY_PEPPER'],
        message: 'must be replaced before production boot',
      });
    }

    rejectLocalEndpoint(context, 'DATABASE_URL', value.DATABASE_URL);
    rejectLocalEndpoint(context, 'REDIS_URL', value.REDIS_URL);
    rejectLocalEndpoint(context, 'S3_ENDPOINT', value.S3_ENDPOINT);
    if (PRODUCTION_LOCAL_HOSTS.has(value.CLAMAV_HOST.toLowerCase())) {
      context.addIssue({
        code: 'custom',
        path: ['CLAMAV_HOST'],
        message: 'must not point at localhost in production',
      });
    }

    if (value.AI_MODE === 'private') {
      if (!privateEndpoint || privateEndpoint.protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          path: ['AI_PRIVATE_ENDPOINT'],
          message: 'must use https in production',
        });
      }
      if (!value.AI_PRIVATE_ALLOWED_HOSTS) {
        context.addIssue({
          code: 'custom',
          path: ['AI_PRIVATE_ALLOWED_HOSTS'],
          message: 'is required when AI_MODE is private in production',
        });
      } else if (
        privateEndpoint &&
        !value.AI_PRIVATE_ALLOWED_HOSTS.split(',')
          .map((host) => host.trim().toLowerCase())
          .filter(Boolean)
          .includes(privateEndpoint.hostname.toLowerCase())
      ) {
        context.addIssue({
          code: 'custom',
          path: ['AI_PRIVATE_ENDPOINT'],
          message: 'host must be listed in AI_PRIVATE_ALLOWED_HOSTS',
        });
      }
    }

    if (value.AI_MODE === 'hosted_limited' && !value.AI_HOSTED_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['AI_HOSTED_API_KEY'],
        message: 'is required when AI_MODE is hosted_limited in production',
      });
    }
  });

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function validateApiEnvironment(rawEnvironment: Record<string, unknown>): ApiEnvironment {
  const nodeEnv = nodeEnvSchema.parse(rawEnvironment.NODE_ENV);
  const mergedEnvironment =
    nodeEnv === 'production'
      ? { ...COMMON_DEFAULTS, ...rawEnvironment, NODE_ENV: nodeEnv }
      : { ...COMMON_DEFAULTS, ...LOCAL_DEFAULTS, ...rawEnvironment, NODE_ENV: nodeEnv };

  const parsed = apiEnvironmentSchema.safeParse(mergedEnvironment);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'} ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid RetailBooks API environment: ${details}`);
}

function connectionUrl(protocols: string[]) {
  return z.preprocess(
    emptyStringToUndefined,
    z
      .string({ error: 'is required' })
      .trim()
      .refine(
        (value) => {
          try {
            return protocols.includes(new URL(value).protocol);
          } catch {
            return false;
          }
        },
        { message: `must be a valid ${protocols.join('/')} URL` },
      ),
  );
}

function optionalConnectionUrl(protocols: string[]) {
  return z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .trim()
      .refine(
        (value) => {
          try {
            const url = new URL(value);
            return protocols.includes(url.protocol) && !url.username && !url.password;
          } catch {
            return false;
          }
        },
        { message: `must be a valid ${protocols.join('/')} URL without credentials` },
      )
      .optional(),
  );
}

function urlOrNull(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function stringToNumber(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return value;
}

function rejectLocalEndpoint(
  context: z.RefinementCtx,
  key: 'DATABASE_URL' | 'REDIS_URL' | 'S3_ENDPOINT',
  value: string,
): void {
  const hostname = new URL(value).hostname.toLowerCase();
  if (!PRODUCTION_LOCAL_HOSTS.has(hostname)) return;
  context.addIssue({
    code: 'custom',
    path: [key],
    message: 'must not point at localhost in production',
  });
}
