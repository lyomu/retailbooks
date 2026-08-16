import { z } from 'zod';

export const serviceStatusSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('retailbooks-api'),
  version: z.string(),
  timestamp: z.iso.datetime(),
  dependencies: z.array(serviceStatusSchema).optional(),
});

export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
