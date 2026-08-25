import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { CreditNotesController } from './credit-notes.controller.js';
import { CreditNotesService } from './credit-notes.service.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { DocumentRenderingService } from './document-rendering.service.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';
import { RecurringInvoicesController } from './recurring-invoices.controller.js';
import { RecurringInvoicesService } from './recurring-invoices.service.js';
import { SalesOrdersController } from './sales-orders.controller.js';
import { SalesOrdersService } from './sales-orders.service.js';
import { StatementsController } from './statements.controller.js';
import { StatementsService } from './statements.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule, JobsModule, StorageModule],
  controllers: [
    CustomersController,
    CatalogController,
    InvoicesController,
    PaymentsController,
    CreditNotesController,
    QuotesController,
    SalesOrdersController,
    RecurringInvoicesController,
    StatementsController,
  ],
  providers: [
    CustomersService,
    CatalogService,
    InvoicesService,
    PaymentsService,
    CreditNotesService,
    QuotesService,
    SalesOrdersService,
    DocumentRenderingService,
    RecurringInvoicesService,
    StatementsService,
  ],
})
export class SalesModule {}
