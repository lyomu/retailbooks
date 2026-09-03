import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/**
 * Depends on SalesModule because generating an invoice from billable work goes through the existing
 * `InvoicesService` rather than a second invoice path -- one tax resolution, one numbering
 * sequence, one posting rule, one audit trail.
 */
@Module({
  imports: [AuthModule, OrganizationsModule, SalesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
