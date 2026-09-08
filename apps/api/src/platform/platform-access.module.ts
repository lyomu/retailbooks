import { Module } from '@nestjs/common';

import { PlatformAccessService } from './platform-access.service.js';
import { PlatformGuard } from './platform.guard.js';

/**
 * Just the platform boundary — the grant lookup and the guard that enforces it.
 *
 * Deliberately separate from `PlatformModule`. The console module imports `AutomationModule`, which
 * imports `OrganizationsModule`; country-pack administration lives in `OrganizationsModule` and
 * needs the same guard. Importing the full console module there would close that loop into a
 * circular dependency. This module depends on nothing but the global `DatabaseModule`, so anything
 * may import it.
 */
@Module({
  providers: [PlatformAccessService, PlatformGuard],
  exports: [PlatformAccessService, PlatformGuard],
})
export class PlatformAccessModule {}
