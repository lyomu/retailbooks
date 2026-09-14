import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { EntitlementsModule } from '../platform/entitlements.module.js';
import { DocumentDiscrepancyService } from './document-discrepancy.service.js';
import { DocumentExtractionQueueService } from './document-extraction-queue.service.js';
import { DocumentExtractionReviewService } from './document-extraction-review.service.js';
import { DocumentSearchController } from './document-search.controller.js';
import { DocumentSearchService } from './document-search.service.js';

/**
 * API-process side of Phase 13D/13F: enqueueing/reviewing extractions, keyword search over them,
 * and document-vs-entry discrepancy detection. The scan/OCR/extraction pipeline itself
 * (`DocumentExtractionService` + its scanner/OCR/storage dependencies) only runs in the worker
 * process -- see `document-extraction-worker.module.ts`.
 */
@Module({
  imports: [AuthModule, OrganizationsModule, EntitlementsModule],
  controllers: [DocumentSearchController],
  providers: [
    DocumentExtractionQueueService,
    DocumentExtractionReviewService,
    DocumentSearchService,
    DocumentDiscrepancyService,
  ],
  exports: [
    DocumentExtractionQueueService,
    DocumentExtractionReviewService,
    DocumentDiscrepancyService,
  ],
})
export class DocumentsModule {}
