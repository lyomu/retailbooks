import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';
import { DocumentExtractionWorker } from './document-extraction.worker.js';
import { DocumentExtractionService } from './document-extraction.service.js';
import { MalwareScannerService } from './malware-scanner.service.js';
import { OcrService } from './ocr.service.js';
import { PdfRasterizerService } from './pdf-rasterizer.service.js';

@Module({
  imports: [StorageModule],
  providers: [
    DocumentExtractionService,
    MalwareScannerService,
    OcrService,
    PdfRasterizerService,
    DocumentExtractionWorker,
  ],
})
export class DocumentExtractionWorkerModule {}
