import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { EntitlementsModule } from '../platform/entitlements.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { AiSuggestionsStore } from './ai-suggestions.store.js';
import { AiController } from './ai.controller.js';
import { AiModelGateway } from './ai-model.gateway.js';
import { AiOrchestrator } from './ai.orchestrator.js';
import { AiRetentionService } from './ai-retention.service.js';
import { AiStore } from './ai.store.js';

@Module({
  imports: [AuthModule, OrganizationsModule, ReportingModule, EntitlementsModule],
  controllers: [AiController],
  providers: [AiModelGateway, AiOrchestrator, AiRetentionService, AiStore, AiSuggestionsStore],
  exports: [AiModelGateway, AiOrchestrator, AiRetentionService, AiStore, AiSuggestionsStore],
})
export class AiModule {}
