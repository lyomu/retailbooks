import { Queue } from 'bullmq';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashToken } from '../src/auth/auth.crypto.js';
import { AuthService, type PublicUser } from '../src/auth/auth.service.js';
import { EMAIL_QUEUE_NAME, type EmailDeliveryJob } from '../src/jobs/email-job.js';
import { producerConnection } from '../src/jobs/redis-connection.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { OrganizationMembersService } from '../src/organizations/organization-members.service.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

const PASSWORD = 'IntegrationPass1!';
const NEW_PASSWORD = 'IntegrationPass2!';
const metadata = { ipHash: 'identity-tenancy-test', userAgent: 'RetailBooks integration test' };
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:56379';
const queuePrefix = process.env.QUEUE_PREFIX ?? 'retailbooks-integration';

describe('identity and tenancy over HTTP', () => {
  let harness: TestHarness;
  let auth: AuthService;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let members: OrganizationMembersService;
  let queue: Queue<EmailDeliveryJob>;
  let redis: RedisClientType;

  beforeAll(async () => {
    harness = await createTestHarness();
    auth = harness.app.get(AuthService);
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
    members = harness.app.get(OrganizationMembersService);
    queue = new Queue<EmailDeliveryJob>(EMAIL_QUEUE_NAME, {
      connection: producerConnection(redisUrl),
      prefix: queuePrefix,
    });
    redis = createClient({ url: redisUrl });
    await redis.connect();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await Promise.all([queue.close(), redis.quit(), harness.close()]);
  });

  beforeEach(async () => {
    await harness.reset();
    await queue.obliterate({ force: true });
    await clearAuthRateLimits(redis);
  });

  it('completes signup, single-use verification, login, session rotation, and logout', async () => {
    const agent = harness.http();
    const email = 'identity@example.test';

    const signup = await agent
      .post(`${API}/auth/signup`)
      .send({ displayName: 'Identity User', email, password: PASSWORD })
      .expect(202);
    expect((signup.body as { data: { message: string } }).data.message).toBe(
      'Check your email for the next step.',
    );

    const verificationToken = await queuedToken(email, '/verify-email?token=');
    await agent.post(`${API}/auth/verify-email`).send({ token: verificationToken }).expect(200);
    await agent.post(`${API}/auth/verify-email`).send({ token: verificationToken }).expect(400);

    const login = await agent
      .post(`${API}/auth/login`)
      .set('User-Agent', 'Stage 2 browser')
      .send({ email, password: PASSWORD })
      .expect(200);
    const originalCookie = sessionCookie(login.headers['set-cookie']);
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    const originalSession = await harness.prisma.session.findFirstOrThrow({
      where: { userId: user.id, status: 'ACTIVE' },
    });

    await harness.prisma.session.update({
      where: { id: originalSession.id },
      data: { lastSeenAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const rotated = await harness.http().get(`${API}/me`).set('Cookie', originalCookie).expect(200);
    expect((rotated.body as { data: { email: string } }).data.email).toBe(email);
    expect(sessionCookie(rotated.headers['set-cookie'])).not.toBe(originalCookie);
    await harness.http().get(`${API}/me`).set('Cookie', originalCookie).expect(401);

    await agent.post(`${API}/auth/logout`).expect(204);
    await agent.get(`${API}/me`).expect(401);
  });

  it('rejects expired verification and recovery tokens', async () => {
    const pending = await harness.prisma.user.create({
      data: { email: 'expired-verify@example.test', displayName: 'Expired Verify' },
    });
    const expiredVerification = 'expired-verification-token-0001';
    await harness.prisma.actionToken.create({
      data: {
        userId: pending.id,
        purpose: 'VERIFY_EMAIL',
        tokenHash: hashToken(expiredVerification),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await harness
      .http()
      .post(`${API}/auth/verify-email`)
      .send({ token: expiredVerification })
      .expect(400);

    const active = await createVerifiedUser('expired-reset@example.test', 'Expired Reset');
    const expiredReset = 'expired-password-reset-token-0001';
    await harness.prisma.actionToken.create({
      data: {
        userId: active.id,
        purpose: 'RESET_PASSWORD',
        tokenHash: hashToken(expiredReset),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    await harness
      .http()
      .post(`${API}/auth/reset-password`)
      .send({ token: expiredReset, password: NEW_PASSWORD })
      .expect(400);
  });

  it('keeps password recovery anti-enumerating, revokes sessions, and consumes the token once', async () => {
    const email = 'recovery@example.test';
    await createVerifiedUser(email, 'Recovery User');
    const signedIn = harness.http();
    await signedIn.post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);

    const known = await harness
      .http()
      .post(`${API}/auth/forgot-password`)
      .send({ email })
      .expect(202);
    const unknown = await harness
      .http()
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'missing@example.test' })
      .expect(202);
    expect(known.body).toEqual(unknown.body);

    const resetToken = await queuedToken(email, '/reset-password?token=');
    await harness
      .http()
      .post(`${API}/auth/reset-password`)
      .send({ token: resetToken, password: NEW_PASSWORD })
      .expect(200);
    await signedIn.get(`${API}/me`).expect(401);
    await harness.http().post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(401);
    await harness
      .http()
      .post(`${API}/auth/login`)
      .send({ email, password: NEW_PASSWORD })
      .expect(200);
    await harness
      .http()
      .post(`${API}/auth/reset-password`)
      .send({ token: resetToken, password: PASSWORD })
      .expect(400);
  });

  it('rate limits repeated login attempts and releases after the Redis window is cleared', async () => {
    const request = () =>
      harness
        .http()
        .post(`${API}/auth/login`)
        .send({ email: 'rate-limit@example.test', password: 'wrong' });

    for (let attempt = 0; attempt < 8; attempt += 1) await request().expect(401);
    await request().expect(429);

    await clearAuthRateLimits(redis);
    await request().expect(401);
  });

  it('returns the identical not-found response for another tenant and an unknown organization', async () => {
    const ownerA = await createVerifiedUser('owner-a@example.test', 'Owner A');
    const ownerB = await createVerifiedUser('owner-b@example.test', 'Owner B');
    const organizationA = await createActiveOrganization(ownerA, 'Organization A Ltd');
    const organizationB = await createActiveOrganization(ownerB, 'Organization B Ltd');
    const agentA = await login(ownerA.email);

    await agentA.get(`${API}/organizations/${organizationA}`).expect(200);
    const crossTenant = await agentA.get(`${API}/organizations/${organizationB}`).expect(404);
    const unknown = await agentA
      .get(`${API}/organizations/00000000-0000-4000-8000-000000000000`)
      .expect(404);

    expect(crossTenant.body).toEqual(unknown.body);
    expect((crossTenant.body as { error: { message: string } }).error.message).toBe(
      'Organization not found.',
    );
  });

  it('accepts an invitation for an existing user and rejects replay', async () => {
    const owner = await createVerifiedUser('invite-owner@example.test', 'Invite Owner');
    const invited = await createVerifiedUser('existing-invitee@example.test', 'Existing Invitee');
    const organizationId = await createActiveOrganization(owner, 'Existing Invite Ltd');
    const invitation = await issueInvitation(owner, organizationId, invited.email);
    const invitedAgent = await login(invited.email);

    await invitedAgent
      .post(`${API}/invitations/accept`)
      .send({ token: invitation.rawToken })
      .expect(200);
    await invitedAgent
      .post(`${API}/invitations/accept`)
      .send({ token: invitation.rawToken })
      .expect(404);
    expect(
      await harness.prisma.organizationMember.count({
        where: { organizationId, userId: invited.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('previews and accepts an invitation through signup for a new user', async () => {
    const owner = await createVerifiedUser('new-invite-owner@example.test', 'New Invite Owner');
    const email = 'new-invitee@example.test';
    const organizationId = await createActiveOrganization(owner, 'New Invite Ltd');
    const invitation = await issueInvitation(owner, organizationId, email);

    const preview = await harness
      .http()
      .post(`${API}/invitations/preview`)
      .send({ token: invitation.rawToken })
      .expect(200);
    expect((preview.body as { data: unknown }).data).toMatchObject({
      email,
      accountExists: false,
      accountVerified: false,
    });

    const agent = harness.http();
    await agent
      .post(`${API}/auth/signup`)
      .send({ displayName: 'New Invitee', email, password: PASSWORD })
      .expect(202);
    const verificationToken = await queuedToken(email, '/verify-email?token=');
    await agent.post(`${API}/auth/verify-email`).send({ token: verificationToken }).expect(200);
    await agent.post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
    await agent.post(`${API}/invitations/accept`).send({ token: invitation.rawToken }).expect(200);

    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(
      await harness.prisma.organizationMember.count({
        where: { organizationId, userId: user.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  async function createVerifiedUser(email: string, displayName: string): Promise<PublicUser> {
    return auth.provisionVerifiedUserForBootstrap(
      { email, displayName, password: PASSWORD },
      metadata,
    );
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

  async function login(email: string) {
    const agent = harness.http();
    await agent.post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(200);
    return agent;
  }

  async function issueInvitation(owner: PublicUser, organizationId: string, email: string) {
    const context = await access.requireMembership(owner.id, organizationId);
    const role = await harness.prisma.role.findFirstOrThrow({
      where: { organizationId, key: 'VIEWER' },
    });
    return members.issueInvitationForBootstrap(
      context,
      owner,
      { email, roleId: role.id },
      metadata,
    );
  }

  async function queuedToken(email: string, marker: string): Promise<string> {
    const jobs = await queue.getJobs(['wait', 'delayed']);
    const job = jobs.find(
      (candidate) => candidate.data.to === email && candidate.data.text.includes(marker),
    );
    const encoded = job?.data.text.split(marker)[1]?.split(/\s/)[0];
    if (!encoded) throw new Error(`No queued token found for ${email} and ${marker}.`);
    return decodeURIComponent(encoded);
  }
});

function sessionCookie(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Expected a session Set-Cookie header.');
  return value.split(';', 1)[0] ?? value;
}

async function clearAuthRateLimits(redis: RedisClientType): Promise<void> {
  const keys = await redis.keys('auth:*');
  if (keys.length > 0) await redis.del(keys);
}
