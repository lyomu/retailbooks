import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { BankRulesController } from './bank-rules.controller.js';
import { BankRulesService } from './bank-rules.service.js';
import { BankTransactionsController } from './bank-transactions.controller.js';
import { BankTransactionsService } from './bank-transactions.service.js';
import { FinancialAccountsController } from './financial-accounts.controller.js';
import { FinancialAccountsService } from './financial-accounts.service.js';
import { ReconciliationsController } from './reconciliations.controller.js';
import { ReconciliationsService } from './reconciliations.service.js';
import { StatementImportsController } from './statement-imports.controller.js';
import { StatementImportsService } from './statement-imports.service.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [
    FinancialAccountsController,
    BankRulesController,
    StatementImportsController,
    BankTransactionsController,
    TransfersController,
    ReconciliationsController,
  ],
  providers: [
    FinancialAccountsService,
    BankRulesService,
    StatementImportsService,
    BankTransactionsService,
    TransfersService,
    ReconciliationsService,
  ],
})
export class BankingModule {}
