import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CountryPackAdminService } from './country-pack.admin.service.js';
import { CreateCountryPackDto, UpdateCountryPackDto } from './country-pack.dto.js';
import { CountryPackStore } from './country-pack.store.js';
import { RequirePlatformRole, type PlatformRequest } from '../platform/platform-context.js';
import { PlatformGuard } from '../platform/platform.guard.js';

/**
 * Country-pack surface (Phase 8B). Reads are authenticated-session-only, mirroring the currency
 * catalog: packs are reference data every authenticated user may see. Mutations are global
 * administrative actions on data every tenant shares, so they require the platform-administrator
 * boundary, not an organization permission. Phase 12 replaced the interim environment-allowlist
 * guard with `PlatformGuard`: mutating global reference data every tenant depends on is a
 * superadmin action, not something a support engineer should hold by default.
 */
@Controller('localization/country-packs')
@UseGuards(SessionGuard)
export class CountryPacksController {
  constructor(
    private readonly store: CountryPackStore,
    private readonly admin: CountryPackAdminService,
    private readonly auth: AuthService,
  ) {}

  private ipHash(request: PlatformRequest): string | null {
    return requestMetadata(request, this.auth.pepper).ipHash;
  }

  @Get()
  async listPublished() {
    return { data: await this.store.listPublished() };
  }

  @Get('admin/all')
  @UseGuards(PlatformGuard)
  @RequirePlatformRole('SUPERADMIN')
  async listAll() {
    return { data: await this.admin.listAll() };
  }

  @Get(':code')
  async resolveLatest(@Param('code') code: string) {
    const pack = await this.store.resolve(code);
    if (!pack) throw new NotFoundException('No published country pack for that code.');
    return { data: pack };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(PlatformGuard)
  @RequirePlatformRole('SUPERADMIN')
  async createDraft(@Body() input: CreateCountryPackDto, @Req() request: PlatformRequest) {
    return {
      data: await this.admin.createDraft(request.platform, input, this.ipHash(request)),
    };
  }

  @Patch(':code/versions/:version')
  @UseGuards(PlatformGuard)
  @RequirePlatformRole('SUPERADMIN')
  async updateDraft(
    @Param('code') code: string,
    @Param('version') version: string,
    @Body() input: UpdateCountryPackDto,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.admin.updateDraft(
        request.platform,
        code,
        version,
        input,
        this.ipHash(request),
      ),
    };
  }

  @Post(':code/versions/:version/publish')
  @HttpCode(200)
  @UseGuards(PlatformGuard)
  @RequirePlatformRole('SUPERADMIN')
  async publish(
    @Param('code') code: string,
    @Param('version') version: string,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.admin.publish(request.platform, code, version, this.ipHash(request)),
    };
  }

  @Post(':code/versions/:version/deprecate')
  @HttpCode(200)
  @UseGuards(PlatformGuard)
  @RequirePlatformRole('SUPERADMIN')
  async deprecate(
    @Param('code') code: string,
    @Param('version') version: string,
    @Req() request: PlatformRequest,
  ) {
    return {
      data: await this.admin.deprecate(request.platform, code, version, this.ipHash(request)),
    };
  }

  @Delete(':code/versions/:version')
  @UseGuards(PlatformGuard)
  @RequirePlatformRole('SUPERADMIN')
  async deleteDraft(
    @Param('code') code: string,
    @Param('version') version: string,
    @Req() request: PlatformRequest,
  ) {
    await this.admin.deleteDraft(request.platform, code, version, this.ipHash(request));
    return { data: { deleted: true } };
  }
}
