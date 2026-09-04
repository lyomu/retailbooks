import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AutomationQueueService } from './automation-queue.service.js';
import { AutomationJobsController } from './automation-jobs.controller.js';
import { AutomationTasksController } from './automation-tasks.controller.js';
import { AutomationTasksService } from './automation-tasks.service.js';
import { ApprovalRequestsController } from './approval-requests.controller.js';
import { ApprovalTargetsService } from './approval-targets.service.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';
import { DomainEventsModule } from './domain-events.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';
import { ScheduledReportsController } from './scheduled-reports.controller.js';
import { ScheduledReportsService } from './scheduled-reports.service.js';
import { SchedulerService } from './scheduler.service.js';
import { WorkflowsController } from './workflows.controller.js';
import { WorkflowsService } from './workflows.service.js';

@Module({
  imports: [AuthModule, JobsModule, OrganizationsModule, DomainEventsModule],
  controllers: [
    ApprovalsController,
    ApprovalRequestsController,
    AutomationJobsController,
    AutomationTasksController,
    WorkflowsController,
    NotificationsController,
    ScheduledReportsController,
    RemindersController,
  ],
  providers: [
    AutomationQueueService,
    ApprovalsService,
    ApprovalTargetsService,
    AutomationTasksService,
    NotificationsService,
    WorkflowsService,
    SchedulerService,
    ScheduledReportsService,
    RemindersService,
  ],
  exports: [
    AutomationQueueService,
    ApprovalsService,
    ApprovalTargetsService,
    AutomationTasksService,
    NotificationsService,
    WorkflowsService,
    SchedulerService,
    ScheduledReportsService,
    RemindersService,
  ],
})
export class AutomationModule {}
