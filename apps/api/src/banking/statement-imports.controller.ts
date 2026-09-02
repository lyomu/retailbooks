import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import type { UploadedFileLike } from '../attachments/attachments.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { MAX_STATEMENT_BYTES, StatementImportsService } from './statement-imports.service.js';

@Controller('organizations/:organizationId/statement-imports')
@UseGuards(SessionGuard, OrganizationGuard)
export class StatementImportsController {
  constructor(
    private readonly imports: StatementImportsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('banking.transactions.view')
  async list(
    @Query('financialAccountId') financialAccountId: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.imports.list(request.organization.id, financialAccountId) };
  }

  @Get(':statementImportId')
  @RequirePermission('banking.transactions.view')
  async detail(
    @Param('statementImportId', new ParseUUIDPipe()) statementImportId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.imports.detail(request.organization.id, statementImportId) };
  }

  @Get(':statementImportId/failed-rows')
  @RequirePermission('banking.transactions.view')
  async failedRows(
    @Param('statementImportId', new ParseUUIDPipe()) statementImportId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.imports.failedRows(request.organization.id, statementImportId) };
  }

  @Post()
  @RequirePermission('banking.transactions.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STATEMENT_BYTES } }))
  async import(
    @Body('financialAccountId') financialAccountId: string,
    @UploadedFile() file: UploadedFileLike,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.imports.import(
        request.organization,
        request.auth.user,
        financialAccountId,
        file,
        metadata,
      ),
    };
  }
}
