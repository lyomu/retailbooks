import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { PortalAccessGuard } from './portal-access.guard.js';
import { PortalAccessService } from './portal-access.service.js';
import {
  InternalPortalsController,
  PortalAccountsController,
  PortalInvitationsController,
} from './portals.controller.js';
import { PortalsService } from './portals.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule, SalesModule, AttachmentsModule, CollaborationModule],
  controllers: [InternalPortalsController, PortalInvitationsController, PortalAccountsController],
  providers: [PortalsService, PortalAccessService, PortalAccessGuard],
})
export class PortalsModule {}
