import { Module } from '@nestjs/common';

import { AutomationModule } from '../automation/automation.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { EntitlementsService } from './entitlements.service.js';
import { PlatformAccessModule } from './platform-access.module.js';
import { PlatformCatalogService } from './platform-catalog.service.js';
import { PlatformOperationsService } from './platform-operations.service.js';
import { PlatformTenantsService } from './platform-tenants.service.js';
import { PlatformController } from './platform.controller.js';

/**
 * Platform administration. Imports `AutomationModule` and `JobsModule` for queue health and job
 * retry, and deliberately imports no tenant feature module: the console reads standing and
 * adoption through Prisma directly, never through a tenant service that expects an
 * `OrganizationContext`.
 *
 * `EntitlementsService` is exported because entitlement resolution is the one piece of this phase
 * the rest of the application will eventually consume — a feature gate belongs next to the feature,
 * not in the console.
 */
@Module({
  imports: [AuthModule, AutomationModule, JobsModule, PlatformAccessModule],
  controllers: [PlatformController],
  providers: [
    PlatformTenantsService,
    PlatformCatalogService,
    PlatformOperationsService,
    EntitlementsService,
  ],
  exports: [EntitlementsService],
})
export class PlatformModule {}
