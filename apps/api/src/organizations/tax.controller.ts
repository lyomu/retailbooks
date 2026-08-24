import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { RequirePermission, type OrganizationRequest } from './organization-context.js';
import { OrganizationGuard } from './organization.guard.js';
import {
  CalculateTaxDto,
  CreateTaxCodeDto,
  CreateTaxRateDto,
  UpdateTaxCodeDto,
} from './tax.dto.js';
import { TaxService } from './tax.service.js';

@Controller('organizations/:organizationId/tax')
@UseGuards(SessionGuard, OrganizationGuard)
export class TaxController {
  constructor(
    private readonly tax: TaxService,
    private readonly auth: AuthService,
  ) {}

  @Get('codes')
  @RequirePermission('tax.codes.view')
  async codes(@Req() request: OrganizationRequest) {
    return { data: await this.tax.listTaxCodes(request.organization.id) };
  }

  @Post('codes')
  @HttpCode(201)
  @RequirePermission('tax.codes.manage')
  async createCode(@Body() input: CreateTaxCodeDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.tax.createTaxCode(request.organization, request.auth.user, input, metadata),
    };
  }

  @Patch('codes/:taxCodeId')
  @RequirePermission('tax.codes.manage')
  async updateCode(
    @Param('taxCodeId', new ParseUUIDPipe()) taxCodeId: string,
    @Body() input: UpdateTaxCodeDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.tax.updateTaxCode(
        request.organization,
        request.auth.user,
        taxCodeId,
        input,
        metadata,
      ),
    };
  }

  @Delete('codes/:taxCodeId')
  @HttpCode(204)
  @RequirePermission('tax.codes.manage')
  async archiveCode(
    @Param('taxCodeId', new ParseUUIDPipe()) taxCodeId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.tax.archiveTaxCode(request.organization, request.auth.user, taxCodeId, metadata);
  }

  @Get('codes/:taxCodeId/rates')
  @RequirePermission('tax.codes.view')
  async rates(
    @Param('taxCodeId', new ParseUUIDPipe()) taxCodeId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.tax.listRates(request.organization.id, taxCodeId) };
  }

  @Post('codes/:taxCodeId/rates')
  @HttpCode(201)
  @RequirePermission('tax.codes.manage')
  async createRate(
    @Param('taxCodeId', new ParseUUIDPipe()) taxCodeId: string,
    @Body() input: CreateTaxRateDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.tax.createRate(
        request.organization,
        request.auth.user,
        taxCodeId,
        input,
        metadata,
      ),
    };
  }

  @Post('calculate')
  @HttpCode(200)
  @RequirePermission('tax.codes.view')
  async calculate(@Body() input: CalculateTaxDto, @Req() request: OrganizationRequest) {
    return { data: await this.tax.calculate(request.organization.id, input) };
  }
}
