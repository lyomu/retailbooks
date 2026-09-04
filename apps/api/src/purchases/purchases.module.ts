import { Module } from '@nestjs/common';

import { AttachmentsModule } from '../attachments/attachments.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DomainEventsModule } from '../automation/domain-events.module.js';
import { AutomationModule } from '../automation/automation.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';
import { ExpenseCategoriesController } from './expense-categories.controller.js';
import { ExpenseCategoriesService } from './expense-categories.service.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';
import { PaymentsMadeController } from './payments-made.controller.js';
import { PaymentsMadeService } from './payments-made.service.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { RecurringBillsController } from './recurring-bills.controller.js';
import { RecurringBillsService } from './recurring-bills.service.js';
import { RecurringExpensesController } from './recurring-expenses.controller.js';
import { RecurringExpensesService } from './recurring-expenses.service.js';
import { VendorCreditsController } from './vendor-credits.controller.js';
import { VendorCreditsService } from './vendor-credits.service.js';
import { VendorsController } from './vendors.controller.js';
import { VendorsService } from './vendors.service.js';

@Module({
  imports: [
    AuthModule,
    OrganizationsModule,
    JobsModule,
    StorageModule,
    AttachmentsModule,
    InventoryModule,
    DomainEventsModule,
    AutomationModule,
  ],
  controllers: [
    VendorsController,
    PurchaseOrdersController,
    BillsController,
    ExpenseCategoriesController,
    ExpensesController,
    VendorCreditsController,
    PaymentsMadeController,
    RecurringBillsController,
    RecurringExpensesController,
  ],
  providers: [
    VendorsService,
    PurchaseOrdersService,
    BillsService,
    ExpenseCategoriesService,
    ExpensesService,
    VendorCreditsService,
    PaymentsMadeService,
    RecurringBillsService,
    RecurringExpensesService,
  ],
  exports: [RecurringBillsService, RecurringExpensesService],
})
export class PurchasesModule {}
