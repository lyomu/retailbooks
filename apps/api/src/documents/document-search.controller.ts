import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { SessionGuard } from '../auth/session.guard.js';
import type { OrganizationRequest } from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import { FeatureFlagGuard, RequireFeatureFlag } from '../platform/feature-flag.guard.js';
import { PHASE13_FEATURE_FLAGS } from '../platform/phase13-feature-flags.js';
import { DocumentSearchService } from './document-search.service.js';

class DocumentSearchQueryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q!: string;
}

/**
 * No single static permission gates this route -- which entity types a search may touch depends on
 * which of `purchases.expenses.view`/`purchases.bills.view` the caller actually holds, computed
 * per-request rather than declared once via `@RequirePermission`.
 */
@Controller('organizations/:organizationId/documents')
@UseGuards(SessionGuard, OrganizationGuard, FeatureFlagGuard)
export class DocumentSearchController {
  constructor(private readonly search: DocumentSearchService) {}

  @Get('search')
  @RequireFeatureFlag(PHASE13_FEATURE_FLAGS.DOCUMENT_EXTRACTION)
  async searchDocuments(
    @Query() query: DocumentSearchQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    const allowedEntityTypes: ('EXPENSE' | 'BILL')[] = [];
    if (request.organization.permissions.has('purchases.expenses.view')) {
      allowedEntityTypes.push('EXPENSE');
    }
    if (request.organization.permissions.has('purchases.bills.view')) {
      allowedEntityTypes.push('BILL');
    }
    if (allowedEntityTypes.length === 0) {
      throw new ForbiddenException('Your role does not allow searching purchase documents.');
    }
    return {
      data: await this.search.search(request.organization.id, query.q, allowedEntityTypes),
    };
  }
}
