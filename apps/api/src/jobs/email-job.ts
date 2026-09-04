export const EMAIL_QUEUE_NAME = 'email-delivery';

export const EMAIL_JOB_NAMES = {
  verification: 'verification',
  passwordReset: 'password-reset',
  organizationInvitation: 'organization-invitation',
  invoiceSend: 'invoice.send',
  creditNoteSend: 'credit_note.send',
  quoteSend: 'quote.send',
  scheduledReport: 'scheduled_report.send',
  invoiceReminder: 'invoice_reminder.send',
  automationNotification: 'automation_notification.send',
} as const;

export type EmailJobName = (typeof EMAIL_JOB_NAMES)[keyof typeof EMAIL_JOB_NAMES];

export type EmailDeliveryJob = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** `path` is a short-lived pre-signed S3 GET URL; nodemailer streams it at send time rather than
   * embedding the PDF bytes in the (Redis-stored) job payload. */
  attachments?: { filename: string; path: string }[];
};
