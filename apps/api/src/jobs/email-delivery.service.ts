import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

import type { EmailDeliveryJob } from './email-job.js';

@Injectable()
export class EmailDeliveryService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const configuredHost = config.get<string>('SMTP_HOST') ?? '127.0.0.1';
    this.transporter = nodemailer.createTransport({
      // On Windows, `localhost` may resolve to an IPv6 listener that Docker Desktop's published
      // SMTP port does not serve. Keep named production hosts unchanged and make local delivery
      // deterministic.
      host: configuredHost === 'localhost' ? '127.0.0.1' : configuredHost,
      port: Number(config.get('SMTP_PORT') ?? 51025),
      secure: false,
      connectionTimeout: 1_500,
      greetingTimeout: 1_500,
      socketTimeout: 3_000,
    });
    this.from = config.get('EMAIL_FROM') ?? 'RetailBooks <no-reply@retailbooks.local>';
  }

  async deliver(message: EmailDeliveryJob): Promise<void> {
    // Delivery errors must escape so BullMQ can apply the configured retry/backoff policy.
    await this.transporter.sendMail({ ...message, from: this.from });
  }
}
