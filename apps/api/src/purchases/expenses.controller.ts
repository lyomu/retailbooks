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
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { CreateExpenseDto, ListExpensesQueryDto, UpdateExpenseDto } from './expenses.dto.js';
import { ExpensesService } from './expenses.service.js';

@Controller('organizations/:organizationId/expenses')
@UseGuards(SessionGuard, OrganizationGuard)
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly attachments: AttachmentsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('purchases.expenses.view')
  async list(@Query() query: ListExpensesQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.expenses.list(request.organization.id, query.status) };
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
    return {
      data: await this.attachments.upload(
        request.organization,
        request.auth.user,
        'EXPENSE',
        expenseId,
        file,
        metadata,
      ),
    };
  }
}
