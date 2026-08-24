export const EMAIL_QUEUE_NAME = 'email-delivery';

export const EMAIL_JOB_NAMES = {
  verification: 'verification',
  passwordReset: 'password-reset',
  organizationInvitation: 'organization-invitation',
} as const;

export type EmailJobName = (typeof EMAIL_JOB_NAMES)[keyof typeof EMAIL_JOB_NAMES];

export type EmailDeliveryJob = {
  to: string;
  subject: string;
  text: string;
  html: string;
};
