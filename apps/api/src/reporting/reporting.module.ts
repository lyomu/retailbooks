import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ReportExportService } from './report-export.service.js';
import { ReportArtifactService } from './report-artifact.service.js';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule, SalesModule],
  controllers: [ReportingController],
  providers: [ReportingService, ReportExportService, ReportArtifactService],
  exports: [ReportingService, ReportExportService, ReportArtifactService],
})
export class ReportingModule {}
