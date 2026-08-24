import { Module } from '@nestjs/common';

import { EmailQueueService } from './email-queue.service.js';

@Module({
  providers: [EmailQueueService],
  exports: [EmailQueueService],
})
export class JobsModule {}
