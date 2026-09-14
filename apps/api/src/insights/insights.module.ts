import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { EntitlementsModule } from '../platform/entitlements.module.js';
import { AuditEvidencePackService } from './audit-evidence-pack.service.js';
import { CashFlowScenarioService } from './cash-flow-scenario.service.js';
import { CloseChecklistService } from './close-checklist.service.js';
import { CollectionsPrioritizerService } from './collections-prioritizer.service.js';
import { CountryPackQaService } from './country-pack-qa.service.js';
import { InsightsController } from './insights.controller.js';
import { InventoryPurchasingAdviserService } from './inventory-purchasing-adviser.service.js';
import { ProjectMarginAdviserService } from './project-margin-adviser.service.js';
import { VarianceInsightService } from './variance-insight.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule, AiModule, EntitlementsModule],
  controllers: [InsightsController],
  providers: [
    VarianceInsightService,
    CloseChecklistService,
    CashFlowScenarioService,
    CollectionsPrioritizerService,
    InventoryPurchasingAdviserService,
    ProjectMarginAdviserService,
    CountryPackQaService,
    AuditEvidencePackService,
  ],
})
export class InsightsModule {}
