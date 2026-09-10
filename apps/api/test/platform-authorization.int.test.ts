import { type INestApplication, RequestMethod, type Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import { PLATFORM_ROLE_KEY, PLATFORM_ROLE_ORDER } from '../src/platform/platform-context.js';
import { PlatformGuard } from '../src/platform/platform.guard.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';
type PlatformRole = (typeof PLATFORM_ROLE_ORDER)[number];

interface PlatformEndpoint {
  method: HttpMethod;
  path: string;
  role: PlatformRole;
}

const ID = '00000000-0000-4000-8000-000000000001';

describe('platform authorization boundary over HTTP', () => {
  let harness: TestHarness;
  let endpoints: PlatformEndpoint[];
  let cookies: Record<'none' | PlatformRole, string>;

  beforeAll(async () => {
    harness = await createTestHarness();
    endpoints = discoverPlatformEndpoints(harness.app);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    const users = await Promise.all(
      ['none', ...PLATFORM_ROLE_ORDER].map((role) =>
        harness.prisma.user.create({
          data: {
            email: `platform-${role}@example.test`,
            displayName: `Platform ${role}`,
            emailVerifiedAt: new Date(),
            status: 'ACTIVE',
          },
        }),
      ),
    );
    cookies = {
      none: await cookieFor(users[0]!.id),
      SUPPORT: await cookieFor(users[1]!.id),
      OPERATIONS: await cookieFor(users[2]!.id),
      SUPERADMIN: await cookieFor(users[3]!.id),
    };
    for (const [index, role] of PLATFORM_ROLE_ORDER.entries()) {
      await harness.prisma.platformAdmin.create({ data: { userId: users[index + 1]!.id, role } });
    }
  });

  it('discovers every platform route and requires a visible platform guard and role floor', () => {
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toContain('get me');
    expect(endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toContain(
      'post feature-flags/:flagId/rules',
    );
  });

  it('refuses every platform route to non-admins and every role below its declared floor', async () => {
    for (const endpoint of endpoints) {
      const label = `${endpoint.method.toUpperCase()} /platform/${endpoint.path}`;
      expect((await requestEndpoint(cookies.none, endpoint)).status, `non-admin ${label}`).toBe(
        403,
      );
      for (const role of PLATFORM_ROLE_ORDER) {
        const response = await requestEndpoint(cookies[role], endpoint);
        const allowed =
          PLATFORM_ROLE_ORDER.indexOf(role) >= PLATFORM_ROLE_ORDER.indexOf(endpoint.role);
        if (allowed) {
          expect(response.status, `${role} ${label}`).not.toBe(403);
        } else {
          expect(response.status, `${role} ${label}`).toBe(403);
        }
      }
    }
  }, 60_000);

  it('uses the environment allowlist only to mint the first database-backed superadmin grant', async () => {
    await harness.prisma.platformAdmin.deleteMany();
    const first = await harness.prisma.user.create({
      data: {
        email: 'bootstrap-first@example.test',
        displayName: 'Bootstrap First',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const second = await harness.prisma.user.create({
      data: {
        email: 'bootstrap-second@example.test',
        displayName: 'Bootstrap Second',
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    const previous = process.env.PLATFORM_ADMIN_EMAILS;
    process.env.PLATFORM_ADMIN_EMAILS = `${first.email},${second.email}`;
    try {
      await harness
        .http()
        .get(`${API}/platform/me`)
        .set('Cookie', await cookieFor(first.id))
        .expect(200)
        .then((response) =>
          expect((response.body as { data: { role: string } }).data.role).toBe('SUPERADMIN'),
        );
      await expect(
        harness.prisma.platformAdmin.findUniqueOrThrow({ where: { userId: first.id } }),
      ).resolves.toMatchObject({ role: 'SUPERADMIN', status: 'ACTIVE' });

      await harness
        .http()
        .get(`${API}/platform/me`)
        .set('Cookie', await cookieFor(second.id))
        .expect(403);
      await expect(
        harness.prisma.platformAdmin.findUnique({ where: { userId: second.id } }),
      ).resolves.toBeNull();
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
      else process.env.PLATFORM_ADMIN_EMAILS = previous;
    }
  });

  async function cookieFor(userId: string): Promise<string> {
    const token = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: 'platform-boundary-test',
        ipHash: 'platform-boundary-test',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${token}`;
  }

  function requestEndpoint(cookie: string, endpoint: PlatformEndpoint) {
    const path = `${API}/platform/${endpoint.path}`
      .replace(':platformAdminId', ID)
      .replace(':organizationId', ID)
      .replace(':userId', ID)
      .replace(':planId', ID)
      .replace(':flagId', ID)
      .replace(':ruleId', ID)
      .replace(':executionId', ID)
      .replace(':key', 'missing-flag');
    const request = harness.http();
    switch (endpoint.method) {
      case 'get':
        return request.get(path).set('Cookie', cookie);
      case 'post':
        return request.post(path).set('Cookie', cookie).send({});
      case 'patch':
        return request.patch(path).set('Cookie', cookie).send({});
      case 'delete':
        return request.delete(path).set('Cookie', cookie);
    }
  }
});

function discoverPlatformEndpoints(app: INestApplication): PlatformEndpoint[] {
  const endpoints: PlatformEndpoint[] = [];
  for (const controller of registeredControllers(app)) {
    const basePath = metadataValue<string>(PATH_METADATA, controller) ?? '';
    if (basePath !== 'platform') continue;
    const classGuards = metadataValue<unknown[]>(GUARDS_METADATA, controller) ?? [];
    const prototype = controller.prototype as object;
    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === 'constructor') continue;
      const handler = Object.getOwnPropertyDescriptor(prototype, methodName)?.value as unknown;
      if (typeof handler !== 'function') continue;
      const path = metadataValue<string>(PATH_METADATA, handler);
      const requestMethod = metadataValue<RequestMethod>(METHOD_METADATA, handler);
      if (path === undefined || requestMethod === undefined) continue;
      expect(classGuards.includes(PlatformGuard), `${controller.name}.${methodName}`).toBe(true);
      const method = RequestMethod[requestMethod]?.toLowerCase();
      if (!isHttpMethod(method)) throw new Error(`Unsupported platform method on ${path}.`);
      endpoints.push({
        method,
        path,
        role: metadataValue<PlatformRole>(PLATFORM_ROLE_KEY, handler) ?? 'SUPPORT',
      });
    }
  }
  return endpoints;
}

function registeredControllers(app: INestApplication): Type[] {
  const controllers: Type[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      if (typeof wrapper.metatype === 'function') controllers.push(wrapper.metatype as Type);
    }
  }
  return controllers;
}

function metadataValue<T>(key: string, target: object): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined;
}

function isHttpMethod(value: string | undefined): value is HttpMethod {
  return value === 'get' || value === 'post' || value === 'patch' || value === 'delete';
}
