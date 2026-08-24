import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';

import { AuthModule } from './auth/auth.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ObservabilityModule } from './common/logging/observability.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DemoSeedService } from './demo-seed.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { JobsModule } from './jobs/jobs.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityModule,
    DatabaseModule,
    JobsModule,
    AuthModule,
    OrganizationsModule,
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    DemoSeedService,
    // Registered here rather than through useGlobalFilters so the filter can inject the logger and
    // the error-reporting seam. Both the production bootstrap and the test harness pick it up.
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
