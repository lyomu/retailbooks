import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import type { PublicUser } from '../auth/auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { RecurringJournalsService } from '../organizations/recurring-journals.service.js';
import { OrganizationAccessService } from '../organizations/organization-access.service.js';
import { RecurringBillsService } from '../purchases/recurring-bills.service.js';
import { RecurringExpensesService } from '../purchases/recurring-expenses.service.js';
import { RecurringInvoicesService } from '../sales/recurring-invoices.service.js';
import { SchedulerService } from './scheduler.service.js';

/** Adapts established recurring services; it never creates a second financial generation path. */
@Injectable()
export class RecurringScheduleRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly access: OrganizationAccessService,
    private readonly invoices: RecurringInvoicesService,
    private readonly bills: RecurringBillsService,
    private readonly expenses: RecurringExpensesService,
    private readonly journals: RecurringJournalsService,
  ) {}

  async execute(executionId: string): Promise<void> {
    const execution = await this.scheduler.beginExecution(executionId);
    if (!execution) return;
    try {
      const job = execution.scheduledJob;
      if (!job.handler.startsWith('recurring.')) {
        throw new Error(`Recurring runner cannot process ${job.handler}.`);
      }
      const context = await this.access.requireMembership(job.createdByUserId, job.organizationId);
      const user = await this.publicUser(job.createdByUserId);
      const metadata = { ipHash: 'automation-worker', userAgent: 'automation-worker' };
      if (job.handler === 'recurring.invoice') {
        await this.invoices.runDueTemplates(context, user, metadata);
      } else if (job.handler === 'recurring.bill') {
        await this.bills.runDueTemplates(context, user, metadata);
      } else if (job.handler === 'recurring.expense') {
        await this.expenses.runDueTemplates(context, user, metadata);
      } else if (job.handler === 'recurring.journal') {
        await this.journals.runDueTemplates(context, user, metadata);
      } else {
        throw new Error(`Unsupported recurring handler ${job.handler}.`);
      }
      await this.scheduler.completeExecution(executionId, { handler: job.handler });
    } catch (error) {
      await this.scheduler.failExecution(executionId, error);
      throw error;
    }
  }

  private async publicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: UserStatus.ACTIVE },
    });
    if (!user) throw new Error('Scheduled job creator is no longer active.');
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerifiedAt !== null,
      status: user.status,
    };
  }
}
