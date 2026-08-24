import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ObservabilityModule } from './common/logging/observability.module.js';
import { JobsWorkerModule } from './jobs/jobs-worker.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ObservabilityModule, JobsWorkerModule],
})
export class WorkerAppModule {}
