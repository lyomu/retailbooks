import type { ConnectionOptions } from 'bullmq';

const DEFAULT_REDIS_URL = 'redis://localhost:56379';

export function producerConnection(redisUrl = process.env.REDIS_URL): ConnectionOptions {
  return {
    url: redisUrl ?? DEFAULT_REDIS_URL,
    maxRetriesPerRequest: 1,
  };
}

export function workerConnection(redisUrl = process.env.REDIS_URL): ConnectionOptions {
  return {
    url: redisUrl ?? DEFAULT_REDIS_URL,
    maxRetriesPerRequest: null,
  };
}
