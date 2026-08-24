import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuditLogController } from './audit-log.controller.js';
import { AuditLogService } from './audit-log.service.js';
import { DocumentNumberingService } from './document-numbering.service.js';
import { FiscalPeriodsService } from './fiscal-periods.service.js';
import { LedgerController } from './ledger.controller.js';
import { LedgerService } from './ledger.service.js';
import { OrganizationAccessService } from './organization-access.service.js';
import { OrganizationMembersService } from './organization-members.service.js';
import { OrganizationGuard } from './organization.guard.js';
import { OrganizationService } from './organization.service.js';
import { InvitationsController, OrganizationsController } from './organizations.controller.js';
import { PermissionsService } from './permissions.service.js';
import { TaxController } from './tax.controller.js';
import { TaxService } from './tax.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    OrganizationsController,
    InvitationsController,
    LedgerController,
    TaxController,
    AuditLogController,
  ],
  providers: [
    OrganizationService,
    OrganizationMembersService,
    PermissionsService,
    FiscalPeriodsService,
    DocumentNumberingService,
    LedgerService,
    TaxService,
    AuditLogService,
    OrganizationAccessService,
    OrganizationGuard,
  ],
  exports: [OrganizationAccessService, OrganizationGuard],
})
export class OrganizationsModule {}
