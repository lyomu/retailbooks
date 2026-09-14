import { Module } from '@nestjs/common';

import { EntitlementsService } from './entitlements.service.js';

/**
 * `EntitlementsService` only depends on the globally-registered `PrismaService`, so this module has
 * no imports of its own -- any feature module can import it to gate a route or a code path behind a
 * flag without pulling in `PlatformModule`'s heavier dependencies (`AutomationModule`, `JobsModule`)
 * or risking a circular import with them.
 */
@Module({
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
