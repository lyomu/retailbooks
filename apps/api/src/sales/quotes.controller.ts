import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { CreateQuoteDto, ListQuotesQueryDto, UpdateQuoteDto } from './quotes.dto.js';
import { QuotesService } from './quotes.service.js';

@Controller('organizations/:organizationId/quotes')
@UseGuards(SessionGuard, OrganizationGuard)
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('sales.quotes.view')
  async list(@Query() query: ListQuotesQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.quotes.list(request.organization.id, query.status) };
  }

  @Get(':quoteId')
  @RequirePermission('sales.quotes.view')
  async detail(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.quotes.detail(request.organization.id, quoteId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('sales.quotes.manage')
  async create(@Body() input: CreateQuoteDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.createDraft(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch(':quoteId')
  @RequirePermission('sales.quotes.manage')
  async update(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Body() input: UpdateQuoteDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.updateDraft(
        request.organization,
        request.auth.user,
        quoteId,
        input,
        metadata,
      ),
    };
  }

  @Post(':quoteId/submit')
  @HttpCode(200)
  @RequirePermission('sales.quotes.manage')
  async submit(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.submitForApproval(
        request.organization,
        request.auth.user,
        quoteId,
        metadata,
      ),
    };
  }

  @Post(':quoteId/approve')
  @HttpCode(200)
  @RequirePermission('sales.quotes.approve')
  async approve(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.approve(request.organization, request.auth.user, quoteId, metadata),
    };
  }

  @Post(':quoteId/send')
  @HttpCode(200)
  @RequirePermission('sales.quotes.manage')
  async send(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.send(request.organization, request.auth.user, quoteId, metadata),
    };
  }

  @Post(':quoteId/accept')
  @HttpCode(200)
  @RequirePermission('sales.quotes.manage')
  async accept(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.accept(request.organization, request.auth.user, quoteId, metadata),
    };
  }

  @Post(':quoteId/decline')
  @HttpCode(200)
  @RequirePermission('sales.quotes.manage')
  async decline(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.decline(request.organization, request.auth.user, quoteId, metadata),
    };
  }

  @Post(':quoteId/expire')
  @HttpCode(200)
  @RequirePermission('sales.quotes.manage')
  async expire(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.expire(request.organization, request.auth.user, quoteId, metadata),
    };
  }

  @Post(':quoteId/convert')
  @HttpCode(200)
  @RequirePermission('sales.quotes.convert')
  async convert(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.quotes.convertToInvoice(
        request.organization,
        request.auth.user,
        quoteId,
        metadata,
      ),
    };
  }
}
