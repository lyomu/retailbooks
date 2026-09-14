import { Module } from '@nestjs/common';

import { AutomationModule } from '../automation/automation.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { EntitlementsModule } from './entitlements.module.js';
import { FeatureFlagGuard } from './feature-flag.guard.js';
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
 * `EntitlementsService` comes from `EntitlementsModule` (kept dependency-light so any feature module
 * can import it directly to gate a route or a code path, without pulling in this module's heavier
 * imports) and is re-exported here for the platform console's own use. `FeatureFlagGuard` is
 * provided here and exported for controllers that use it by class reference in `@UseGuards()` --
 * whichever module owns such a controller must import `EntitlementsModule` too (for constructor
 * injection to resolve) but does not need to import this whole module.
 */
@Module({
  imports: [AuthModule, AutomationModule, JobsModule, PlatformAccessModule, EntitlementsModule],
  controllers: [PlatformController],
  providers: [
    PlatformTenantsService,
    PlatformCatalogService,
    PlatformOperationsService,
    FeatureFlagGuard,
  ],
  exports: [EntitlementsModule, FeatureFlagGuard],
})
export class PlatformModule {}
