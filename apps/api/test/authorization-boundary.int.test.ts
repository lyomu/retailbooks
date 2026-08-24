import { RequestMethod, type Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { AuditLogController } from '../src/organizations/audit-log.controller.js';
import { CurrencyController } from '../src/organizations/currency.controller.js';
import { LedgerController } from '../src/organizations/ledger.controller.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { PERMISSION_KEY } from '../src/organizations/organization-context.js';
import { OrganizationGuard } from '../src/organizations/organization.guard.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { OrganizationsController } from '../src/organizations/organizations.controller.js';
import type { PermissionKey } from '../src/organizations/permission-catalog.js';
import { SYSTEM_ROLE_KEYS, type SystemRoleKey } from '../src/organizations/roles-catalog.js';
import { TaxController } from '../src/organizations/tax.controller.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

interface EndpointCase {
  method: HttpMethod;
  path: string;
  permission?: PermissionKey;
  body?: string | object;
}

const ID = '00000000-0000-4000-8000-000000000001';
const UNKNOWN_ORGANIZATION = '00000000-0000-4000-8000-000000000000';
const metadata = {
  ipHash: 'authorization-boundary-test',
  userAgent: 'RetailBooks integration test',
};

const ENDPOINTS: readonly EndpointCase[] = [
  { method: 'get', path: 'organizations/:organizationId', permission: 'organization.view' },
  {
    method: 'patch',
    path: 'organizations/:organizationId',
    permission: 'organization.update',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/finalize',
    permission: 'organization.finalize',
  },
  { method: 'post', path: 'organizations/:organizationId/activate' },
  { method: 'get', path: 'organizations/:organizationId/members', permission: 'members.view' },
  {
    method: 'patch',
    path: 'organizations/:organizationId/members/:memberId',
    permission: 'members.update',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/members/:memberId',
    permission: 'members.remove',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/invitations',
    permission: 'invitations.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/invitations',
    permission: 'members.invite',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/invitations/:invitationId',
    permission: 'invitations.revoke',
  },
  { method: 'get', path: 'organizations/:organizationId/roles', permission: 'roles.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/roles',
    permission: 'roles.create',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/roles/:roleId',
    permission: 'roles.manage',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/roles/:roleId',
    permission: 'roles.delete',
  },
  { method: 'get', path: 'organizations/:organizationId/periods', permission: 'periods.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/fiscal-years',
    permission: 'periods.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/:periodId/close',
    permission: 'periods.close',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/:periodId/lock',
    permission: 'periods.close',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/:periodId/reopen',
    permission: 'periods.unlock',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/:periodId/unlock',
    permission: 'periods.unlock',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/numbering',
    permission: 'numbering.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/numbering/journal',
    permission: 'numbering.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/numbering/:documentType',
    permission: 'numbering.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/numbering/:documentType',
    permission: 'numbering.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/currencies',
    permission: 'organization.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/currencies',
    permission: 'settings.currency.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/currencies/:currencyCode',
    permission: 'settings.currency.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/currencies/exchange-rates',
    permission: 'settings.currency.manage',
    body: {},
  },
  { method: 'get', path: 'organizations/:organizationId/accounts', permission: 'accounts.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/accounts',
    permission: 'accounts.create',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/accounts/:accountId',
    permission: 'accounts.update',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/accounts/:accountId',
    permission: 'accounts.deactivate',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/accounts/:accountId/ledger',
    permission: 'reports.view',
  },
  { method: 'get', path: 'organizations/:organizationId/journals', permission: 'journals.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/journals',
    permission: 'journals.create',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/journals/:journalId',
    permission: 'journals.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/journals/:journalId',
    permission: 'journals.create',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/journals/:journalId',
    permission: 'journals.create',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/journals/:journalId/post',
    permission: 'journals.post',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/journals/:journalId/reverse',
    permission: 'journals.reverse',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reports/trial-balance',
    permission: 'reports.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/tax/codes',
    permission: 'tax.codes.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/tax/codes',
    permission: 'tax.codes.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/tax/codes/:taxCodeId',
    permission: 'tax.codes.manage',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/tax/codes/:taxCodeId',
    permission: 'tax.codes.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/tax/codes/:taxCodeId/rates',
    permission: 'tax.codes.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/tax/codes/:taxCodeId/rates',
    permission: 'tax.codes.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/tax/calculate',
    permission: 'tax.codes.view',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/audit-log',
    permission: 'audit.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/audit-log/export',
    permission: 'audit.export',
  },
];

const CONTROLLERS: readonly Type[] = [
  OrganizationsController,
  CurrencyController,
  LedgerController,
  TaxController,
  AuditLogController,
];

describe('organization authorization boundary over HTTP', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let organizationId: string;
  let otherOrganizationId: string;
  let owner: PublicUser;
  let ownerMemberId: string;
  let adminRoleId: string;
  let actors: Map<SystemRoleKey, { cookie: string; permissions: Set<string> }>;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    owner = await createUser('boundary-owner@example.test', 'Boundary Owner');
    organizationId = await createActiveOrganization(owner, 'Authorization Matrix Ltd');
    actors = new Map();

    const roles = await harness.prisma.role.findMany({
      where: { organizationId },
      include: { permissions: true },
    });
    for (const roleKey of SYSTEM_ROLE_KEYS) {
      const role = roles.find((candidate) => candidate.key === roleKey);
      if (!role) throw new Error(`Missing system role ${roleKey}.`);
      const user =
        roleKey === 'OWNER'
          ? owner
          : await createUser(
              `${roleKey.toLowerCase().replaceAll('_', '-')}@example.test`,
              role.name,
            );
      if (roleKey !== 'OWNER') {
        await harness.prisma.organizationMember.create({
          data: { organizationId, userId: user.id, roleId: role.id, status: 'ACTIVE' },
        });
      }
      actors.set(roleKey, {
        cookie: await sessionCookieFor(user.id),
        permissions: new Set(role.permissions.map((permission) => permission.permissionKey)),
      });
    }

    ownerMemberId = (
      await harness.prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: owner.id } },
      })
    ).id;
    adminRoleId = roles.find((role) => role.key === 'ADMIN')?.id ?? '';

    const otherOwner = await createUser('other-owner@example.test', 'Other Owner');
    otherOrganizationId = await createActiveOrganization(otherOwner, 'Other Tenant Ltd');
  });

  it('keeps the declared matrix synchronized with every organization-scoped controller route and guard', () => {
    const discovered = discoverOrganizationEndpoints(CONTROLLERS);
    expect(normalizeEndpoints(ENDPOINTS)).toEqual(normalizeEndpoints(discovered));
  });

  it('enforces the eight-role permission matrix on every organization-scoped endpoint', async () => {
    for (const [roleKey, actor] of actors) {
      for (const endpoint of ENDPOINTS) {
        const response = await requestEndpoint(actor.cookie, endpoint, organizationId);
        const allowed = !endpoint.permission || actor.permissions.has(endpoint.permission);
        const description = `${roleKey} ${endpoint.method.toUpperCase()} ${endpoint.path} (${endpoint.permission ?? 'membership'})`;
        if (allowed) {
          expect(response.status, description).not.toBe(403);
          expect(response.status, description).not.toBe(401);
        } else {
          expect(response.status, description).toBe(403);
        }
      }
    }
  });

  it('returns the same not-found envelope for another tenant and an unknown tenant on every endpoint', async () => {
    const ownerActor = required(actors.get('OWNER'), 'Owner actor is missing.');
    for (const endpoint of ENDPOINTS) {
      const crossTenant = await requestEndpoint(ownerActor.cookie, endpoint, otherOrganizationId);
      const unknown = await requestEndpoint(ownerActor.cookie, endpoint, UNKNOWN_ORGANIZATION);
      expect(crossTenant.status, `${endpoint.method} ${endpoint.path}`).toBe(404);
      expect(unknown.status, `${endpoint.method} ${endpoint.path}`).toBe(404);
      expect(crossTenant.body).toEqual(unknown.body);
    }
  });

  it('rejects protected permissions when creating a custom role through HTTP', async () => {
    const ownerActor = required(actors.get('OWNER'), 'Owner actor is missing.');
    for (const permission of ['organization.finalize', 'roles.manage'] as const) {
      await harness
        .http()
        .post(`${API}/organizations/${organizationId}/roles`)
        .set('Cookie', ownerActor.cookie)
        .send({ name: `Escalator ${permission}`, permissions: [permission] })
        .expect(400);
    }
  });

  it('keeps the owner unremovable and unreassignable through HTTP', async () => {
    const ownerActor = required(actors.get('OWNER'), 'Owner actor is missing.');
    await harness
      .http()
      .patch(`${API}/organizations/${organizationId}/members/${ownerMemberId}`)
      .set('Cookie', ownerActor.cookie)
      .send({ roleId: adminRoleId })
      .expect(400);
    await harness
      .http()
      .delete(`${API}/organizations/${organizationId}/members/${ownerMemberId}`)
      .set('Cookie', ownerActor.cookie)
      .expect(400);
  });

  it('grants audit viewing only to the four intended system roles', async () => {
    const granted = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'] as const;
    const denied = ['SALES', 'PURCHASES', 'INVENTORY_MANAGER', 'PROJECT_MANAGER'] as const;
    for (const role of granted) {
      await harness
        .http()
        .get(`${API}/organizations/${organizationId}/audit-log`)
        .set('Cookie', required(actors.get(role), `${role} actor is missing.`).cookie)
        .expect(200);
    }
    for (const role of denied) {
      await harness
        .http()
        .get(`${API}/organizations/${organizationId}/audit-log`)
        .set('Cookie', required(actors.get(role), `${role} actor is missing.`).cookie)
        .expect(403);
    }
  });

  async function createUser(email: string, displayName: string): Promise<PublicUser> {
    const user = await harness.prisma.user.create({
      data: { email, displayName, emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
  }

  async function createActiveOrganization(user: PublicUser, legalName: string): Promise<string> {
    const created = await organizations.create(
      user,
      { legalName, businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const context = await access.requireMembership(user.id, created.id);
    await organizations.finalize(context, user, metadata);
    return created.id;
  }

  async function sessionCookieFor(userId: string): Promise<string> {
    const rawToken = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${rawToken}`;
  }

  async function requestEndpoint(cookie: string, endpoint: EndpointCase, tenantId: string) {
    const path = `${API}/${endpoint.path}`
      .replace(':organizationId', tenantId)
      .replace(':memberId', ID)
      .replace(':invitationId', ID)
      .replace(':roleId', ID)
      .replace(':periodId', ID)
      .replace(':currencyCode', 'USD')
      .replace(':accountId', ID)
      .replace(':journalId', ID)
      .replace(':taxCodeId', ID)
      .replace(':documentType', 'INVOICE');
    const test = harness.http()[endpoint.method](path).set('Cookie', cookie);
    if (endpoint.body !== undefined) test.send(endpoint.body);
    return test;
  }
});

function discoverOrganizationEndpoints(controllers: readonly Type[]): EndpointCase[] {
  const endpoints: EndpointCase[] = [];
  for (const controller of controllers) {
    const basePath = metadataValue<string>(PATH_METADATA, controller) ?? '';
    const classGuards = metadataValue<unknown[]>(GUARDS_METADATA, controller) ?? [];
    const prototype = controller.prototype as object;
    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === 'constructor') continue;
      const handler = Object.getOwnPropertyDescriptor(prototype, methodName)?.value as unknown;
      if (typeof handler !== 'function') continue;
      const routePath = metadataValue<string>(PATH_METADATA, handler);
      const requestMethod = metadataValue<RequestMethod>(METHOD_METADATA, handler);
      if (routePath === undefined || requestMethod === undefined) continue;

      const fullPath = [basePath, routePath]
        .filter(Boolean)
        .join('/')
        .replace(/\/{2,}/g, '/')
        .replace(/\/$/, '');
      if (!fullPath.includes(':organizationId')) continue;
      const handlerGuards = metadataValue<unknown[]>(GUARDS_METADATA, handler) ?? [];
      expect(
        [...classGuards, ...handlerGuards].includes(OrganizationGuard),
        `${controller.name}.${methodName} is organization-scoped but lacks OrganizationGuard`,
      ).toBe(true);

      const method = RequestMethod[requestMethod]?.toLowerCase();
      if (!isHttpMethod(method)) throw new Error(`Unsupported request method on ${fullPath}.`);
      const permission = metadataValue<PermissionKey>(PERMISSION_KEY, handler);
      endpoints.push({ method, path: fullPath, ...(permission ? { permission } : {}) });
    }
  }
  return endpoints;
}

function metadataValue<T>(key: string, target: object): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined;
}

function normalizeEndpoints(endpoints: readonly EndpointCase[]): string[] {
  return endpoints
    .map(
      (endpoint) =>
        `${endpoint.method.toUpperCase()} ${endpoint.path} ${endpoint.permission ?? 'MEMBERSHIP'}`,
    )
    .sort();
}

function isHttpMethod(value: string | undefined): value is HttpMethod {
  return value === 'get' || value === 'post' || value === 'patch' || value === 'delete';
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
