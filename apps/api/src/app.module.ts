import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';

import { AuthModule } from './auth/auth.module.js';
import { AutomationModule } from './automation/automation.module.js';
import { BankingModule } from './banking/banking.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { ObservabilityModule } from './common/logging/observability.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DemoSeedService } from './demo-seed.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ReportingModule } from './reporting/reporting.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { SalesModule } from './sales/sales.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ObservabilityModule,
    DatabaseModule,
    JobsModule,
    AutomationModule,
    AuthModule,
    OrganizationsModule,
    SalesModule,
    PurchasesModule,
    BankingModule,
    InventoryModule,
    ProjectsModule,
    ReportingModule,
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
