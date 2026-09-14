import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWorker } from 'tesseract.js';

export class OcrFailedError extends Error {}

export interface OcrLine {
  readonly text: string;
  readonly page: number;
  readonly bbox: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

export interface OcrResult {
  readonly text: string;
  readonly lines: readonly OcrLine[];
}

/**
 * Pure local OCR (tesseract.js: WASM, no native binary or external service to install/patch). Bounds
 * wall-clock time and output length -- this is resource/time/output-limited, not OS-level sandboxed
 * (no seccomp/separate container); real process isolation is a deployment-hardening step beyond this
 * slice. The returned text/lines are treated purely as data by the caller: no tool-calling, no
 * model, no instruction-following -- a regex/heuristic extractor only reads them, never executes
 * them. Line bounding boxes are what let the extractor cite a field's source region.
 */
@Injectable()
export class OcrService {
  constructor(private readonly config: ConfigService) {}

  /** `pageNumber` only tags the returned lines (for multi-page-PDF source regions); it does not
   * affect recognition, which always runs on the single image buffer given. */
  async recognize(imageBuffer: Buffer, pageNumber = 1): Promise<OcrResult> {
    const timeoutMs = this.config.getOrThrow<number>('OCR_TIMEOUT_MS');
    const maxChars = this.config.getOrThrow<number>('OCR_MAX_TEXT_CHARS');

    const worker = await createWorker('eng');
    try {
      const page = await withTimeout(
        worker.recognize(imageBuffer, {}, { blocks: true }).then((result) => result.data),
        timeoutMs,
        () => new OcrFailedError('OCR timed out.'),
      );
      const lines: OcrLine[] = [];
      for (const block of page.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            lines.push({ text: line.text.trim(), page: pageNumber, bbox: line.bbox });
          }
        }
      }
      return { text: page.text.slice(0, maxChars), lines };
    } catch (error) {
      if (error instanceof OcrFailedError) throw error;
      throw new OcrFailedError(error instanceof Error ? error.message : 'OCR failed.');
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
