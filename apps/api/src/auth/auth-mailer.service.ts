import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EMAIL_JOB_NAMES, type EmailDeliveryJob, type EmailJobName } from '../jobs/email-job.js';
import { EmailQueueService } from '../jobs/email-queue.service.js';

@Injectable()
export class AuthMailerService {
  private readonly logger = new Logger(AuthMailerService.name);
  private readonly webUrl: string;

  constructor(
    config: ConfigService,
    private readonly emailQueue: EmailQueueService,
  ) {
    this.webUrl = (config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  async sendVerification(email: string, displayName: string, token: string): Promise<void> {
    const url = `${this.webUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send(EMAIL_JOB_NAMES.verification, {
      to: email,
      subject: 'Verify your RetailBooks email',
      text: `Hello ${displayName},\n\nVerify your email to continue setting up RetailBooks:\n${url}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
      html: this.template(
        'Verify your email',
        `Hello ${escapeHtml(displayName)}, confirm your email address to continue setting up your accounting workspace.`,
        'Verify email',
        url,
        'This link expires in 24 hours.',
      ),
    });
  }

  async sendPasswordReset(email: string, displayName: string, token: string): Promise<void> {
    const url = `${this.webUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(EMAIL_JOB_NAMES.passwordReset, {
      to: email,
      subject: 'Reset your RetailBooks password',
      text: `Hello ${displayName},\n\nUse this link to reset your RetailBooks password:\n${url}\n\nThis link expires in 30 minutes. If you did not request this, no action is needed.`,
      html: this.template(
        'Reset your password',
        `Hello ${escapeHtml(displayName)}, use the secure link below to choose a new password.`,
        'Reset password',
        url,
        'This link expires in 30 minutes and can only be used once.',
      ),
    });
  }

  async sendOrganizationInvitation(invitation: {
    email: string;
    organizationName: string;
    inviterName: string;
    /** Human-readable role name, e.g. "Administrator" or "Sales" -- the role's own `name` column. */
    roleName: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const url = `${this.webUrl}/accept-invitation?token=${encodeURIComponent(invitation.token)}`;
    const expiry = invitation.expiresAt.toISOString().slice(0, 10);
    await this.send(EMAIL_JOB_NAMES.organizationInvitation, {
      to: invitation.email,
      subject: `Join ${invitation.organizationName} on RetailBooks`,
      text: `${invitation.inviterName} invited you to join ${invitation.organizationName} on RetailBooks as ${invitation.roleName}.\n\nAccept the invitation:\n${url}\n\nThis invitation expires on ${expiry}. If you were not expecting it, you can ignore this email.`,
      html: this.template(
        `Join ${escapeHtml(invitation.organizationName)}`,
        `${escapeHtml(invitation.inviterName)} invited you to work in ${escapeHtml(invitation.organizationName)} on RetailBooks as <strong>${escapeHtml(invitation.roleName)}</strong>.`,
        'Accept invitation',
        url,
        `This invitation expires on ${expiry} and can only be used once.`,
      ),
    });
  }

  private async send(name: EmailJobName, message: EmailDeliveryJob): Promise<void> {
    try {
      await this.emailQueue.enqueue(name, message);
    } catch (error) {
      this.logger.error(
        `Transactional email enqueue failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private template(
    title: string,
    copy: string,
    button: string,
    url: string,
    footnote: string,
  ): string {
    return `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#061c3d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #dfe6ef;border-radius:14px"><tr><td style="padding:28px"><div style="font-weight:700;font-size:18px;margin-bottom:28px">RetailBooks</div><h1 style="font-size:26px;line-height:1.2;margin:0 0 12px">${escapeHtml(title)}</h1><p style="color:#526681;line-height:1.6;margin:0 0 24px">${copy}</p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0879e8;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px">${escapeHtml(button)}</a><p style="color:#718096;font-size:13px;line-height:1.5;margin:24px 0 0">${escapeHtml(footnote)}</p></td></tr></table></td></tr></table></body></html>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] ?? character,
  );
}
