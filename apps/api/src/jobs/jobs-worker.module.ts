import { Module } from '@nestjs/common';

import { EmailDeliveryService } from './email-delivery.service.js';
import { EmailWorker } from './email.worker.js';

@Module({ providers: [EmailDeliveryService, EmailWorker] })
export class JobsWorkerModule {}
