import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  AttachmentsService,
  MAX_ATTACHMENT_BYTES,
  type UploadedFileLike,
} from '../attachments/attachments.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { DocumentDiscrepancyService } from '../documents/document-discrepancy.service.js';
import { DocumentExtractionQueueService } from '../documents/document-extraction-queue.service.js';
import { DocumentExtractionReviewService } from '../documents/document-extraction-review.service.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { EntitlementsService } from '../platform/entitlements.service.js';
import { FeatureFlagGuard, RequireFeatureFlag } from '../platform/feature-flag.guard.js';
import { PHASE13_FEATURE_FLAGS } from '../platform/phase13-feature-flags.js';
import { CategorizationSuggestionService } from './categorization-suggestion.service.js';
import { DraftNoteService } from './draft-note.service.js';
import { CreateExpenseDto, ListExpensesQueryDto, UpdateExpenseDto } from './expenses.dto.js';
import { ExpensesService } from './expenses.service.js';

@Controller('organizations/:organizationId/expenses')
@UseGuards(SessionGuard, OrganizationGuard, FeatureFlagGuard)
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly attachments: AttachmentsService,
    private readonly auth: AuthService,
    private readonly extractionQueue: DocumentExtractionQueueService,
    private readonly extractionReview: DocumentExtractionReviewService,
    private readonly categorization: CategorizationSuggestionService,
    private readonly draftNote: DraftNoteService,
    private readonly discrepancies: DocumentDiscrepancyService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get()
  @RequirePermission('purchases.expenses.view')
  async list(@Query() query: ListExpensesQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.expenses.list(request.organization.id, query.status) };
  }

  // Registered before the generic :expenseId route below so 'categorization-suggestion' is never
  // matched as an expenseId value.
  @Get('categorization-suggestion')
  @RequirePermission('purchases.expenses.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS)
  async categorizationSuggestion(
    @Query('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.categorization.suggestForVendor(request.organization.id, vendorId),
    };
  }

  @Get(':expenseId')
  @RequirePermission('purchases.expenses.view')
  async detail(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.expenses.detail(request.organization.id, expenseId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('purchases.expenses.manage')
  async create(@Body() input: CreateExpenseDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.expenses.createDraft(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch(':expenseId')
  @RequirePermission('purchases.expenses.manage')
  async update(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Body() input: UpdateExpenseDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.expenses.updateDraft(
        request.organization,
        request.auth.user,
        expenseId,
        input,
        metadata,
      ),
    };
  }

  @Post(':expenseId/submit')
  @HttpCode(200)
  @RequirePermission('purchases.expenses.manage')
  async submit(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.expenses.submit(
        request.organization,
        request.auth.user,
        expenseId,
        metadata,
      ),
    };
  }

  @Post(':expenseId/approve')
  @HttpCode(200)
  @RequirePermission('purchases.expenses.approve')
  async approve(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.expenses.approve(
        request.organization,
        request.auth.user,
        expenseId,
        metadata,
      ),
    };
  }

  @Post(':expenseId/post')
  @HttpCode(200)
  @RequirePermission('purchases.expenses.post')
  async post(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.expenses.post(
        request.organization,
        request.auth.user,
        expenseId,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Post(':expenseId/void')
  @HttpCode(200)
  @RequirePermission('purchases.expenses.void')
  async void(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.expenses.voidExpense(
        request.organization,
        request.auth.user,
        expenseId,
        metadata,
      ),
    };
  }

  @Post(':expenseId/cancel')
  @HttpCode(200)
  @RequirePermission('purchases.expenses.manage')
  async cancel(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.expenses.cancel(
        request.organization,
        request.auth.user,
        expenseId,
        metadata,
      ),
    };
  }

  @Get(':expenseId/attachments')
  @RequirePermission('purchases.expenses.view')
  async listAttachments(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.attachments.list(request.organization.id, 'EXPENSE', expenseId) };
  }

  /**
   * Phase 11 stopped putting a signed URL on every listed attachment: a listing is not an
   * authorization to fetch bytes. This endpoint re-checks access and issues the short-lived link.
   */
  @Get(':expenseId/attachments/:attachmentId/download')
  @RequirePermission('purchases.expenses.view')
  async downloadAttachment(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.attachments.download(
        request.organization.id,
        'EXPENSE',
        expenseId,
        attachmentId,
      ),
    };
  }

  @Post(':expenseId/attachments')
  @HttpCode(201)
  @RequirePermission('purchases.expenses.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async uploadAttachment(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @UploadedFile() file: UploadedFileLike,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    const uploaded = await this.attachments.upload(
      request.organization,
      request.auth.user,
      'EXPENSE',
      expenseId,
      file,
      metadata,
    );
    // Every Expense attachment is scanned, regardless of type; only image types go on to OCR. The
    // worker itself decides that branch -- this route just starts the pipeline. Upload itself is
    // not behind a flag (it predates Phase 13D); only the extraction pipeline it kicks off is.
    if (
      await this.entitlements.isFlagEnabled(
        request.organization.id,
        PHASE13_FEATURE_FLAGS.DOCUMENT_EXTRACTION,
      )
    ) {
      await this.extractionQueue.enqueue(uploaded.id);
    }
    return { data: uploaded };
  }

  @Get(':expenseId/attachments/:attachmentId/extraction')
  @RequirePermission('purchases.expenses.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.DOCUMENT_EXTRACTION)
  async getExtraction(
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.extractionReview.get(request.organization.id, attachmentId) };
  }

  @Post(':expenseId/attachments/:attachmentId/extraction/accept')
  @RequirePermission('purchases.expenses.manage')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.DOCUMENT_EXTRACTION)
  async acceptExtraction(
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.extractionReview.accept(
        request.organization.id,
        attachmentId,
        request.auth.user,
        metadata,
      ),
    };
  }

  @Post(':expenseId/attachments/:attachmentId/extraction/reject')
  @RequirePermission('purchases.expenses.manage')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.DOCUMENT_EXTRACTION)
  async rejectExtraction(
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.extractionReview.reject(
        request.organization.id,
        attachmentId,
        request.auth.user,
        metadata,
      ),
    };
  }

  @Get(':expenseId/draft-note')
  @RequirePermission('purchases.expenses.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.AI_SUGGESTIONS)
  async draftNoteForExpense(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.draftNote.draftForExpense(request.organization.id, expenseId) };
  }

  @Get(':expenseId/discrepancies')
  @RequirePermission('purchases.expenses.view')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.APPROVAL_AUTOMATION)
  async discrepanciesForExpense(
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.discrepancies.forExpense(request.organization.id, expenseId) };
  }
}
