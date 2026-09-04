import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { PurchasesModule } from '../purchases/purchases.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AutomationQueueService } from './automation-queue.service.js';
import { AutomationWorker } from './automation.worker.js';
import { DomainEventsModule } from './domain-events.module.js';
import { NotificationsService } from './notifications.service.js';
import { OutboxRelayService } from './outbox-relay.service.js';
import { RecurringScheduleRunnerService } from './recurring-schedule-runner.service.js';
import { RemindersService } from './reminders.service.js';
import { ScheduledReportRunnerService } from './scheduled-report-runner.service.js';
import { SchedulerPollerService } from './scheduler-poller.service.js';
import { SchedulerService } from './scheduler.service.js';
import { WorkflowsService } from './workflows.service.js';

@Module({
  imports: [
    OrganizationsModule,
    SalesModule,
    PurchasesModule,
    ReportingModule,
    StorageModule,
    JobsModule,
    DomainEventsModule,
  ],
  providers: [
    AutomationQueueService,
    OutboxRelayService,
    NotificationsService,
    WorkflowsService,
    SchedulerService,
    SchedulerPollerService,
    ScheduledReportRunnerService,
    RecurringScheduleRunnerService,
    RemindersService,
    AutomationWorker,
  ],
})
export class AutomationWorkerModule {}
