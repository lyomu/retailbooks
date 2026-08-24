import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import supertest from 'supertest';

import { configureApp } from '../../src/app-setup.js';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { truncateAll } from './database.js';

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
    reset: () => truncateAll(prisma),
    close: async () => {
      await app.close();
    },
  };
}

/** Convenience prefix so specs read as the routes they exercise. */
export const API = '/api/v1';
