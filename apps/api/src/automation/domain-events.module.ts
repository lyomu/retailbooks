import { Module } from '@nestjs/common';

import { CLOCK, SystemClock } from './clock.js';
import { DomainEventsService } from './domain-events.service.js';

/**
 * Narrow dependency boundary used by accounting modules without importing automation controllers.
 * Also the single place `CLOCK` is provided -- every module that needs a due-time/retry/replay seam
 * (`AutomationModule`, `AutomationWorkerModule`) already imports this one for `DomainEventsService`,
 * so they get the same clock for free rather than each declaring their own binding.
 */
@Module({
  providers: [DomainEventsService, { provide: CLOCK, useClass: SystemClock }],
  exports: [DomainEventsService, CLOCK],
})
export class DomainEventsModule {}
