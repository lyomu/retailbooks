import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';
import { AttachmentsService } from './attachments.service.js';

@Module({
  imports: [StorageModule],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
