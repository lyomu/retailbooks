import { Canvas, createCanvas } from '@napi-rs/canvas';
import { Injectable } from '@nestjs/common';
// pdfjs-dist's default build targets a browser DOM; the legacy Node build accepts a canvas factory
// instead, which is what lets this run without a real display or browser environment.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export class PdfRasterizeError extends Error {}

const MAX_PAGES = 5;
const RENDER_SCALE = 2.0;

interface CanvasAndContext {
  canvas: Canvas;
  context: ReturnType<Canvas['getContext']>;
}

/** Minimal canvas factory pdf.js's legacy Node build asks for -- it never touches the DOM itself. */
class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: CanvasAndContext): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

/**
 * Rasterizes the first `MAX_PAGES` pages of a PDF to PNG buffers so the existing image OCR path can
 * read them -- pdf.js parses/renders the page description locally; nothing is sent anywhere, and
 * this never evaluates embedded PDF JavaScript (`isEvalSupported: false`). Bounded to a small page
 * count so a many-page PDF can't turn one extraction job into unbounded work.
 */
@Injectable()
export class PdfRasterizerService {
  async rasterize(pdfBuffer: Buffer): Promise<Buffer[]> {
    // pdf.js constructs this itself (`new CanvasFactory(...)`), so this must be the class, not an
    // already-constructed instance -- passing an instance throws "CanvasFactory is not a
    // constructor" before any page is even parsed, which is real behavior confirmed against the
    // pdfjs-dist version this project pins, not a hypothetical concern.
    const factory = new NodeCanvasFactory();
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      CanvasFactory: NodeCanvasFactory,
      useSystemFonts: true,
    });

    try {
      const doc = await loadingTask.promise;
      const pageCount = Math.min(doc.numPages, MAX_PAGES);
      const images: Buffer[] = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const { canvas, context } = factory.create(viewport.width, viewport.height);
        await page.render({
          // pdf.js's TS types expect a browser HTMLCanvasElement/CanvasRenderingContext2D (not in
          // this project's lib target); @napi-rs/canvas's context implements everything render()
          // actually calls at runtime but not every DOM method, hence the deliberate `any`/`null`.
          canvas: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          canvasContext: context as any,
          viewport,
        }).promise;
        images.push(canvas.toBuffer('image/png'));
        page.cleanup();
      }
      return images;
    } catch (error) {
      throw new PdfRasterizeError(error instanceof Error ? error.message : 'Failed to render PDF.');
    } finally {
      await loadingTask.destroy();
    }
  }
}
