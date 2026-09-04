import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ObservabilityModule } from './common/logging/observability.module.js';
import { AutomationWorkerModule } from './automation/automation-worker.module.js';
import { JobsWorkerModule } from './jobs/jobs-worker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityModule,
    JobsWorkerModule,
    AutomationWorkerModule,
  ],
})
export class WorkerAppModule {}
