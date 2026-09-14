import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import supertest from 'supertest';

import { configureApp } from '../../src/app-setup.js';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PHASE13_FEATURE_FLAGS } from '../../src/platform/phase13-feature-flags.js';
import { truncateAll } from './database.js';

/**
 * `truncateAll` empties every table between tests, including `feature_flags` -- so every Phase 13
 * route gated by `FeatureFlagGuard` would 403 in every test unless something puts the flags back.
 * Production seeds these once via migration and never truncates; the test harness has to redo it
 * after every reset. Default-enabled, mirroring the `add_phase13g_feature_flags` seed migration, so
 * existing specs see the same "on" behavior real deployments do; a spec that wants to exercise the
 * kill switch can still flip one row's `defaultEnabled` before making its request.
 *
 * `phase13.hosted_ai_egress` is the one deliberate exception: it seeds `defaultEnabled: false` here
 * too, mirroring its production seed migration, so that "AI_MODE=hosted_limited with the flag unset
 * still behaves as disabled" stays true in every integration test, not just production. A spec that
 * wants to exercise the enabled path adds its own `ORGANIZATION`-scope `FeatureFlagRule`.
 */
async function seedPhase13FeatureFlags(prisma: PrismaService): Promise<void> {
  for (const key of Object.values(PHASE13_FEATURE_FLAGS)) {
    const defaultEnabled = key !== PHASE13_FEATURE_FLAGS.HOSTED_AI_EGRESS;
    await prisma.featureFlag.upsert({
      where: { key },
      update: {},
      create: { key, name: key, defaultEnabled, status: 'ACTIVE' },
    });
  }
}

export interface TestHarness {
  app: INestApplication;
  prisma: PrismaService;
  /** A supertest agent bound to the running app. Paths are relative to the `api/v1` prefix. */
  http: () => supertest.Agent;
  /** Empties every application table. Call between tests that share the harness. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Boots the real application module against the test database, configured exactly as production is
 * via {@link configureApp}, and returns a supertest agent bound to it.
 */
export async function createTestHarness(): Promise<TestHarness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    http: () => supertest.agent(app.getHttpServer() as Server),
    reset: async () => {
      await truncateAll(prisma);
      await seedPhase13FeatureFlags(prisma);
    },
    close: async () => {
      await app.close();
    },
  };
}

/** Convenience prefix so specs read as the routes they exercise. */
export const API = '/api/v1';
