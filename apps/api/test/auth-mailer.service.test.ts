import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { AuthMailerService } from '../src/auth/auth-mailer.service';
import { EMAIL_JOB_NAMES, type EmailDeliveryJob, type EmailJobName } from '../src/jobs/email-job';

describe('AuthMailerService', () => {
  it('enqueues each transactional email with the correct job name', async () => {
    const queued: Array<[EmailJobName, EmailDeliveryJob]> = [];
    const enqueue = vi.fn((name: EmailJobName, message: EmailDeliveryJob) => {
      queued.push([name, message]);
      return Promise.resolve();
    });
    const mailer = new AuthMailerService(
      new ConfigService({ WEB_APP_URL: 'https://app.example.test/' }),
      { enqueue } as never,
    );

    await mailer.sendVerification('owner@example.test', 'Ada & Co', 'verify token');
    await mailer.sendPasswordReset('owner@example.test', 'Ada & Co', 'reset token');
    await mailer.sendOrganizationInvitation({
      email: 'member@example.test',
      organizationName: 'Ada & Co',
      inviterName: 'Ada',
      roleName: 'Accountant',
      token: 'invite token',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(queued.map(([name]) => name)).toEqual([
      EMAIL_JOB_NAMES.verification,
      EMAIL_JOB_NAMES.passwordReset,
      EMAIL_JOB_NAMES.organizationInvitation,
    ]);
    expect(queued[0]?.[1]).toMatchObject({
      to: 'owner@example.test',
      subject: 'Verify your RetailBooks email',
    });
    expect(queued[0]?.[1].text).toContain(
      'https://app.example.test/verify-email?token=verify%20token',
    );
  });

  it('does not fail the caller when Redis cannot accept a mail job', async () => {
    const mailer = new AuthMailerService(new ConfigService(), {
      enqueue: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    } as never);

    await expect(
      mailer.sendVerification('owner@example.test', 'Ada', 'token'),
    ).resolves.toBeUndefined();
  });
});
