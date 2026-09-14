export const DOCUMENT_EXTRACTION_QUEUE_NAME = 'document-extraction';

export const DOCUMENT_EXTRACTION_JOB_NAMES = {
  extract: 'extract',
} as const;

export type DocumentExtractionJobName =
  (typeof DOCUMENT_EXTRACTION_JOB_NAMES)[keyof typeof DOCUMENT_EXTRACTION_JOB_NAMES];

export type ExtractionJob = { attachmentId: string };

export type DocumentExtractionJob = ExtractionJob;
