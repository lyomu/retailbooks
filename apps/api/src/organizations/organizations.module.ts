import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DomainEventsModule } from '../automation/domain-events.module.js';
import { PlatformAccessModule } from '../platform/platform-access.module.js';
import { PostingRulesService } from '../posting-rules/posting-rules.service.js';
import { AuditLogController } from './audit-log.controller.js';
import { AuditLogService } from './audit-log.service.js';
import { CountryPackAdminService } from './country-pack.admin.service.js';
import { CountryPacksController } from './country-packs.controller.js';
import { CurrencyCatalogController, CurrencyController } from './currency.controller.js';
import { CurrencyService } from './currency.service.js';
import { DocumentNumberingService } from './document-numbering.service.js';
import { FiscalPeriodsService } from './fiscal-periods.service.js';
import { LedgerController } from './ledger.controller.js';
import { LedgerService } from './ledger.service.js';
import { OrganizationAccessService } from './organization-access.service.js';
import { OrganizationMembersService } from './organization-members.service.js';
import { OrganizationGuard } from './organization.guard.js';
import { OrganizationService } from './organization.service.js';
import {
  InvitationsController,
  OrganizationsController,
  PermissionsController,
} from './organizations.controller.js';
import { OpeningBalancesController } from './opening-balances.controller.js';
import { OpeningBalancesService } from './opening-balances.service.js';
import { RecurringJournalsController } from './recurring-journals.controller.js';
import { RecurringJournalsService } from './recurring-journals.service.js';
import { FxRevaluationController } from './fx-revaluation.controller.js';
import { FxRevaluationService } from './fx-revaluation.service.js';
import { RoundingService } from './rounding.service.js';
import { CountryPackStore } from './country-pack.store.js';
import { RolesService } from './roles.service.js';
import { TaxController } from './tax.controller.js';
import { TaxService } from './tax.service.js';

@Module({
  imports: [AuthModule, DomainEventsModule, PlatformAccessModule],
  controllers: [
    OrganizationsController,
    InvitationsController,
    PermissionsController,
    CurrencyCatalogController,
    CurrencyController,
    LedgerController,
    TaxController,
    AuditLogController,
    OpeningBalancesController,
    RecurringJournalsController,
    FxRevaluationController,
    CountryPacksController,
  ],
  providers: [
    OrganizationService,
    CountryPackAdminService,
    OrganizationMembersService,
    RolesService,
    FiscalPeriodsService,
    DocumentNumberingService,
    LedgerService,
    PostingRulesService,
    OpeningBalancesService,
    RecurringJournalsService,
    FxRevaluationService,
    RoundingService,
    TaxService,
    AuditLogService,
    CurrencyService,
    CountryPackStore,
    OrganizationAccessService,
    OrganizationGuard,
  ],
  exports: [
    OrganizationAccessService,
    OrganizationGuard,
    OrganizationService,
    OrganizationMembersService,
    RolesService,
    FiscalPeriodsService,
    DocumentNumberingService,
    LedgerService,
    PostingRulesService,
    TaxService,
    CurrencyService,
    CountryPackStore,
    CountryPackAdminService,
  ],
})
export class OrganizationsModule {}
