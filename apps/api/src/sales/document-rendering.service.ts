import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';

import { PrismaService } from '../database/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

export type RenderableDocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'QUOTE';

/**
 * Renders a document to PDF once and caches the result as a `DocumentSnapshot` -- a re-send never
 * re-renders, it just returns the already-stored `storageKey`. Rendering happens synchronously in the
 * API request that calls it (not offloaded to the worker process): the render and the snapshot row
 * land together, so there's no distributed two-phase state to reconcile between processes.
 */
@Injectable()
export class DocumentRenderingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async render(
    organizationId: string,
    documentType: RenderableDocumentType,
    documentId: string,
    html: string,
  ): Promise<{ storageKey: string; cached: boolean }> {
    const existing = await this.prisma.documentSnapshot.findUnique({
      where: {
        organizationId_documentType_documentId: { organizationId, documentType, documentId },
      },
    });
    if (existing) return { storageKey: existing.storageKey, cached: true };

    const pdf = await this.renderPdf(html);
    const storageKey = `${organizationId}/${documentType.toLowerCase()}/${documentId}.pdf`;

    await this.storage.ensureBucket();
    await this.storage.upload(storageKey, pdf, 'application/pdf');
    await this.prisma.documentSnapshot.create({
      data: { organizationId, documentType, documentId, storageKey },
    });

    return { storageKey, cached: false };
  }

  async getSignedUrl(storageKey: string): Promise<string> {
    return this.storage.getSignedDownloadUrl(storageKey);
  }

  /** Shared Playwright PDF seam used by immutable sales snapshots and ephemeral report exports. */
  async renderPdf(html: string): Promise<Buffer> {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      return await page.pdf({ format: 'A4', printBackground: true });
    } finally {
      await browser.close();
    }
  }
}
