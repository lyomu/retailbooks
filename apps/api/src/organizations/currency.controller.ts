import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  EnableOrganizationCurrencyDto,
  UpdateOrganizationCurrencyDto,
  UpsertExchangeRateDto,
} from './currency.dto.js';
import { CurrencyService } from './currency.service.js';
import { OrganizationGuard } from './organization.guard.js';
import { RequirePermission, type OrganizationRequest } from './organization-context.js';

@Controller('localization/currencies')
@UseGuards(SessionGuard)
export class CurrencyCatalogController {
  constructor(private readonly currencies: CurrencyService) {}

  @Get()
  async list() {
    return { data: await this.currencies.catalog() };
  }
}

@Controller('organizations/:organizationId/currencies')
@UseGuards(SessionGuard, OrganizationGuard)
export class CurrencyController {
  constructor(
    private readonly currencies: CurrencyService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermission('organization.view')
  async list(@Req() request: OrganizationRequest) {
    return { data: await this.currencies.list(request.organization.id) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('settings.currency.manage')
  async enable(@Body() input: EnableOrganizationCurrencyDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.currencies.enable(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Patch(':currencyCode')
  @RequirePermission('settings.currency.manage')
  async updateEnabled(
    @Param('currencyCode') currencyCode: string,
    @Body() input: UpdateOrganizationCurrencyDto,
    @Req() request: OrganizationRequest,
  ) {
    return {
      data: await this.currencies.updateEnabled(
        request.organization,
        request.auth.user,
        currencyCode,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }

  @Post('exchange-rates')
  @HttpCode(201)
  @RequirePermission('settings.currency.manage')
  async upsertRate(@Body() input: UpsertExchangeRateDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.currencies.upsertRate(
        request.organization,
        request.auth.user,
        input,
        requestMetadata(request, this.auth.pepper),
      ),
    };
  }
}
