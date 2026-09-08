import { type INestApplication, RequestMethod, type Type } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken } from '../src/auth/auth.crypto.js';
import type { PublicUser } from '../src/auth/auth.service.js';
import { OrganizationAccessService } from '../src/organizations/organization-access.service.js';
import { PERMISSION_KEY } from '../src/organizations/organization-context.js';
import { OrganizationGuard } from '../src/organizations/organization.guard.js';
import { OrganizationService } from '../src/organizations/organization.service.js';
import type { PermissionKey } from '../src/organizations/permission-catalog.js';
import { SYSTEM_ROLE_KEYS, type SystemRoleKey } from '../src/organizations/roles-catalog.js';
import { API, createTestHarness, type TestHarness } from './support/app.js';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

interface EndpointCase {
  method: HttpMethod;
  path: string;
  permission?: PermissionKey;
  body?: string | object;
}

const ID = '00000000-0000-4000-8000-000000000001';
const UNKNOWN_ORGANIZATION = '00000000-0000-4000-8000-000000000000';
const metadata = {
  ipHash: 'authorization-boundary-test',
  userAgent: 'RetailBooks integration test',
};

const ENDPOINTS: readonly EndpointCase[] = [
  { method: 'get', path: 'organizations/:organizationId', permission: 'organization.view' },
  {
    method: 'patch',
    path: 'organizations/:organizationId',
    permission: 'organization.update',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/finalize',
    permission: 'organization.finalize',
  },
  { method: 'post', path: 'organizations/:organizationId/activate' },
  { method: 'get', path: 'organizations/:organizationId/members', permission: 'members.view' },
  {
    method: 'patch',
    path: 'organizations/:organizationId/members/:memberId',
    permission: 'members.update',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/members/:memberId',
    permission: 'members.remove',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/invitations',
    permission: 'invitations.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/invitations',
    permission: 'members.invite',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/invitations/:invitationId',
    permission: 'invitations.revoke',
  },
  { method: 'get', path: 'organizations/:organizationId/roles', permission: 'roles.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/roles',
    permission: 'roles.create',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/roles/:roleId',
    permission: 'roles.manage',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/roles/:roleId',
    permission: 'roles.delete',
  },
  { method: 'get', path: 'organizations/:organizationId/periods', permission: 'periods.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/fiscal-years',
    permission: 'periods.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/:periodId/close',
    permission: 'periods.close',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/:periodId/lock',
    permission: 'periods.close',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/:periodId/reopen',
    permission: 'periods.unlock',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/periods/:periodId/unlock',
    permission: 'periods.unlock',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/numbering',
    permission: 'numbering.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/numbering/journal',
    permission: 'numbering.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/numbering/:documentType',
    permission: 'numbering.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/numbering/:documentType',
    permission: 'numbering.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/currencies',
    permission: 'organization.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/currencies',
    permission: 'settings.currency.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/currencies/:currencyCode',
    permission: 'settings.currency.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/currencies/exchange-rates',
    permission: 'settings.currency.manage',
    body: {},
  },
  { method: 'get', path: 'organizations/:organizationId/accounts', permission: 'accounts.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/accounts',
    permission: 'accounts.create',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/accounts/:accountId',
    permission: 'accounts.update',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/accounts/:accountId',
    permission: 'accounts.deactivate',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/accounts/:accountId/ledger',
    permission: 'reports.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/opening-balances',
    permission: 'accounts.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/opening-balances/:batchId',
    permission: 'accounts.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/opening-balances',
    permission: 'accounts.opening_balances.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/opening-balances/:batchId',
    permission: 'accounts.opening_balances.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/opening-balances/:batchId/validate',
    permission: 'accounts.opening_balances.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/opening-balances/:batchId/finalize',
    permission: 'accounts.opening_balances.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/opening-balances/:batchId/void',
    permission: 'accounts.opening_balances.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/recurring-journals',
    permission: 'journals.recurring.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/recurring-journals/:templateId',
    permission: 'journals.recurring.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-journals',
    permission: 'journals.recurring.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/recurring-journals/:templateId',
    permission: 'journals.recurring.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-journals/:templateId/deactivate',
    permission: 'journals.recurring.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-journals/:templateId/reactivate',
    permission: 'journals.recurring.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-journals/run-due',
    permission: 'journals.recurring.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/fx-revaluations',
    permission: 'journals.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/fx-revaluations/run',
    permission: 'journals.post',
    body: {},
  },
  { method: 'get', path: 'organizations/:organizationId/journals', permission: 'journals.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/journals',
    permission: 'journals.create',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/journals/:journalId',
    permission: 'journals.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/journals/:journalId',
    permission: 'journals.create',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/journals/:journalId',
    permission: 'journals.create',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/journals/:journalId/post',
    permission: 'journals.post',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/journals/:journalId/reverse',
    permission: 'journals.reverse',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reports/trial-balance',
    permission: 'reports.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reports/definitions',
    permission: 'reports.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reports/filter-options',
    permission: 'reports.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reports/saved',
    permission: 'reports.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/reports/saved',
    permission: 'reports.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/reports/saved/:savedReportId',
    permission: 'reports.manage',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/reports/saved/:savedReportId',
    permission: 'reports.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reports/:reportKey/export',
    permission: 'reports.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reports/:reportKey',
    permission: 'reports.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/tax/codes',
    permission: 'tax.codes.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/tax/codes',
    permission: 'tax.codes.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/tax/codes/:taxCodeId',
    permission: 'tax.codes.manage',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/tax/codes/:taxCodeId',
    permission: 'tax.codes.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/tax/codes/:taxCodeId/rates',
    permission: 'tax.codes.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/tax/codes/:taxCodeId/rates',
    permission: 'tax.codes.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/tax/calculate',
    permission: 'tax.codes.view',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/audit-log',
    permission: 'audit.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/audit-log/export',
    permission: 'audit.export',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/approval-policies',
    permission: 'automation.approvals.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/approval-policies',
    permission: 'automation.approvals.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/approval-policies/inbox',
    permission: 'automation.approvals.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/approval-policies/requests/mine',
    permission: 'automation.approvals.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/approval-policies/requests/:requestId',
    permission: 'automation.approvals.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/approval-policies/requests/:requestId/decision',
    permission: 'automation.approvals.view',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/approval-policies/requests/:requestId/cancel',
    permission: 'automation.approvals.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/automation/approval-policies/:policyId',
    permission: 'automation.approvals.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/approval-policies/:policyId/activate',
    permission: 'automation.approvals.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/approval-policies/:policyId/deactivate',
    permission: 'automation.approvals.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/approval-requests',
    permission: 'automation.approvals.view',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/workflow-rules',
    permission: 'automation.rules.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/workflow-rules',
    permission: 'automation.rules.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/automation/workflow-rules/:ruleId',
    permission: 'automation.rules.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/automation/workflow-rules/:ruleId/status',
    permission: 'automation.rules.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/workflow-rules/:ruleId/dry-run',
    permission: 'automation.rules.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/workflow-rules/:ruleId/runs',
    permission: 'automation.rules.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/tasks/mine',
    permission: 'automation.rules.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/tasks/:taskId/complete',
    permission: 'automation.rules.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/reminder-policies',
    permission: 'automation.schedules.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/reminder-policies',
    permission: 'automation.schedules.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/automation/reminder-policies/:policyId',
    permission: 'automation.schedules.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/automation/reminder-policies/:policyId/active',
    permission: 'automation.schedules.manage',
    body: { active: true },
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/jobs/failed',
    permission: 'automation.jobs.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/automation/jobs/:executionId',
    permission: 'automation.jobs.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/automation/jobs/:executionId/retry',
    permission: 'automation.jobs.retry',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/notifications',
    permission: 'notifications.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/notifications/unread-count',
    permission: 'notifications.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/notifications/preferences',
    permission: 'notifications.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/notifications/preferences',
    permission: 'notifications.manage',
    body: { eventKey: 'automation.workflow_rule_created' },
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/notifications/:notificationId/read',
    permission: 'notifications.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/notifications/read-all',
    permission: 'notifications.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reports/scheduled',
    permission: 'automation.schedules.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/reports/scheduled',
    permission: 'automation.schedules.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/reports/scheduled/:scheduledReportId',
    permission: 'automation.schedules.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/reports/scheduled/:scheduledReportId/active',
    permission: 'automation.schedules.manage',
    body: { active: true },
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/customers',
    permission: 'customers.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/customers/:contactId',
    permission: 'customers.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/customers',
    permission: 'customers.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/customers/:contactId',
    permission: 'customers.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/customers/:contactId/deactivate',
    permission: 'customers.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/customers/:contactId/reactivate',
    permission: 'customers.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/customers/:contactId/statement',
    permission: 'sales.statements.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/catalog/units',
    permission: 'catalog.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/catalog/units',
    permission: 'catalog.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/catalog/units/:unitId',
    permission: 'catalog.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/catalog/categories',
    permission: 'catalog.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/catalog/categories',
    permission: 'catalog.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/catalog/categories/:categoryId',
    permission: 'catalog.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/catalog/items',
    permission: 'catalog.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/catalog/items/:itemId',
    permission: 'catalog.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/catalog/items',
    permission: 'catalog.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/catalog/items/:itemId',
    permission: 'catalog.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/catalog/items/:itemId/deactivate',
    permission: 'catalog.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/catalog/items/:itemId/reactivate',
    permission: 'catalog.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/invoices',
    permission: 'sales.invoices.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/invoices/:invoiceId',
    permission: 'sales.invoices.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/invoices',
    permission: 'sales.invoices.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/invoices/:invoiceId',
    permission: 'sales.invoices.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/invoices/:invoiceId/issue',
    permission: 'sales.invoices.issue',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/invoices/:invoiceId/void',
    permission: 'sales.invoices.void',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/invoices/:invoiceId/send',
    permission: 'sales.documents.send',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/payments',
    permission: 'sales.payments.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/payments/:paymentId',
    permission: 'sales.payments.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/payments/:paymentId/open-invoices',
    permission: 'sales.payments.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/payments',
    permission: 'sales.payments.record',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/payments/:paymentId/allocate',
    permission: 'sales.payments.allocate',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/credit-notes',
    permission: 'sales.credit_notes.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/credit-notes/:creditNoteId',
    permission: 'sales.credit_notes.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/credit-notes/:creditNoteId/open-invoices',
    permission: 'sales.credit_notes.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/credit-notes',
    permission: 'sales.credit_notes.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/credit-notes/:creditNoteId',
    permission: 'sales.credit_notes.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/credit-notes/:creditNoteId/issue',
    permission: 'sales.credit_notes.issue',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/credit-notes/:creditNoteId/void',
    permission: 'sales.credit_notes.void',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/credit-notes/:creditNoteId/allocate',
    permission: 'sales.credit_notes.allocate',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/credit-notes/:creditNoteId/refund',
    permission: 'sales.credit_notes.refund',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/credit-notes/:creditNoteId/send',
    permission: 'sales.documents.send',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/quotes',
    permission: 'sales.quotes.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/quotes/:quoteId',
    permission: 'sales.quotes.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/quotes',
    permission: 'sales.quotes.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/quotes/:quoteId',
    permission: 'sales.quotes.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/quotes/:quoteId/submit',
    permission: 'sales.quotes.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/quotes/:quoteId/approve',
    permission: 'sales.quotes.approve',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/quotes/:quoteId/send',
    permission: 'sales.quotes.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/quotes/:quoteId/accept',
    permission: 'sales.quotes.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/quotes/:quoteId/decline',
    permission: 'sales.quotes.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/quotes/:quoteId/expire',
    permission: 'sales.quotes.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/quotes/:quoteId/convert',
    permission: 'sales.quotes.convert',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/sales-orders',
    permission: 'sales.orders.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/sales-orders/:orderId',
    permission: 'sales.orders.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/sales-orders',
    permission: 'sales.orders.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/sales-orders/:orderId',
    permission: 'sales.orders.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/sales-orders/:orderId/approve',
    permission: 'sales.orders.approve',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/sales-orders/:orderId/confirm',
    permission: 'sales.orders.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/sales-orders/:orderId/partially-fulfill',
    permission: 'sales.orders.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/sales-orders/:orderId/fulfill',
    permission: 'sales.orders.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/sales-orders/:orderId/cancel',
    permission: 'sales.orders.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/sales-orders/:orderId/convert',
    permission: 'sales.orders.convert',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/recurring-invoices',
    permission: 'sales.recurring_invoices.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/recurring-invoices/:templateId',
    permission: 'sales.recurring_invoices.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-invoices',
    permission: 'sales.recurring_invoices.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/recurring-invoices/:templateId',
    permission: 'sales.recurring_invoices.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-invoices/:templateId/deactivate',
    permission: 'sales.recurring_invoices.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-invoices/:templateId/reactivate',
    permission: 'sales.recurring_invoices.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-invoices/run-due',
    permission: 'sales.recurring_invoices.manage',
  },
  { method: 'get', path: 'organizations/:organizationId/vendors', permission: 'vendors.view' },
  {
    method: 'get',
    path: 'organizations/:organizationId/vendors/check-duplicate',
    permission: 'vendors.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/vendors/:vendorId',
    permission: 'vendors.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/vendors',
    permission: 'vendors.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/vendors/:vendorId',
    permission: 'vendors.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/vendors/:vendorId/deactivate',
    permission: 'vendors.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/vendors/:vendorId/reactivate',
    permission: 'vendors.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/purchase-orders',
    permission: 'purchases.orders.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/purchase-orders/:orderId',
    permission: 'purchases.orders.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/purchase-orders',
    permission: 'purchases.orders.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/purchase-orders/:orderId',
    permission: 'purchases.orders.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/purchase-orders/:orderId/approve',
    permission: 'purchases.orders.approve',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/purchase-orders/:orderId/issue',
    permission: 'purchases.orders.issue',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/purchase-orders/:orderId/receipt',
    permission: 'purchases.orders.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/purchase-orders/:orderId/close',
    permission: 'purchases.orders.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/purchase-orders/:orderId/cancel',
    permission: 'purchases.orders.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/bills',
    permission: 'purchases.bills.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/bills/:billId',
    permission: 'purchases.bills.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bills',
    permission: 'purchases.bills.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/bills/:billId',
    permission: 'purchases.bills.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bills/:billId/issue',
    permission: 'purchases.bills.issue',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bills/:billId/void',
    permission: 'purchases.bills.void',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/bills/:billId/attachments',
    permission: 'purchases.bills.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bills/:billId/attachments',
    permission: 'purchases.bills.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/expense-categories',
    permission: 'purchases.expense_categories.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/expense-categories',
    permission: 'purchases.expense_categories.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/expense-categories/:categoryId',
    permission: 'purchases.expense_categories.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/expenses',
    permission: 'purchases.expenses.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/expenses/:expenseId',
    permission: 'purchases.expenses.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/expenses',
    permission: 'purchases.expenses.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/expenses/:expenseId',
    permission: 'purchases.expenses.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/expenses/:expenseId/submit',
    permission: 'purchases.expenses.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/expenses/:expenseId/approve',
    permission: 'purchases.expenses.approve',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/expenses/:expenseId/post',
    permission: 'purchases.expenses.post',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/expenses/:expenseId/void',
    permission: 'purchases.expenses.void',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/expenses/:expenseId/cancel',
    permission: 'purchases.expenses.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/expenses/:expenseId/attachments',
    permission: 'purchases.expenses.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/expenses/:expenseId/attachments',
    permission: 'purchases.expenses.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/vendor-credits',
    permission: 'purchases.vendor_credits.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/vendor-credits/:vendorCreditId',
    permission: 'purchases.vendor_credits.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/vendor-credits/:vendorCreditId/open-bills',
    permission: 'purchases.vendor_credits.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/vendor-credits',
    permission: 'purchases.vendor_credits.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/vendor-credits/:vendorCreditId',
    permission: 'purchases.vendor_credits.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/vendor-credits/:vendorCreditId/issue',
    permission: 'purchases.vendor_credits.issue',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/vendor-credits/:vendorCreditId/void',
    permission: 'purchases.vendor_credits.void',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/vendor-credits/:vendorCreditId/allocate',
    permission: 'purchases.vendor_credits.allocate',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/payments-made',
    permission: 'purchases.payments_made.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/payments-made/:paymentId',
    permission: 'purchases.payments_made.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/payments-made/:paymentId/open-bills',
    permission: 'purchases.payments_made.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/payments-made',
    permission: 'purchases.payments_made.record',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/payments-made/:paymentId/allocate',
    permission: 'purchases.payments_made.allocate',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/recurring-bills',
    permission: 'purchases.recurring_bills.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/recurring-bills/:templateId',
    permission: 'purchases.recurring_bills.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-bills',
    permission: 'purchases.recurring_bills.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/recurring-bills/:templateId',
    permission: 'purchases.recurring_bills.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-bills/:templateId/deactivate',
    permission: 'purchases.recurring_bills.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-bills/:templateId/reactivate',
    permission: 'purchases.recurring_bills.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-bills/run-due',
    permission: 'purchases.recurring_bills.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/recurring-expenses',
    permission: 'purchases.recurring_expenses.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/recurring-expenses/:templateId',
    permission: 'purchases.recurring_expenses.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-expenses',
    permission: 'purchases.recurring_expenses.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/recurring-expenses/:templateId',
    permission: 'purchases.recurring_expenses.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-expenses/:templateId/deactivate',
    permission: 'purchases.recurring_expenses.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-expenses/:templateId/reactivate',
    permission: 'purchases.recurring_expenses.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/recurring-expenses/run-due',
    permission: 'purchases.recurring_expenses.manage',
  },

  // --- Phase 5: Banking & Reconciliation ---
  {
    method: 'get',
    path: 'organizations/:organizationId/bank-rules/:bankRuleId',
    permission: 'banking.rules.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/bank-rules',
    permission: 'banking.rules.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/bank-rules/:bankRuleId',
    permission: 'banking.rules.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bank-rules',
    permission: 'banking.rules.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/bank-transactions/:bankTransactionId',
    permission: 'banking.transactions.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/bank-transactions',
    permission: 'banking.transactions.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bank-transactions/:bankTransactionId/categorize',
    permission: 'banking.transactions.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bank-transactions/:bankTransactionId/exclude',
    permission: 'banking.transactions.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bank-transactions/:bankTransactionId/match',
    permission: 'banking.transactions.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/bank-transactions/:bankTransactionId/unmatch',
    permission: 'banking.transactions.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/financial-accounts/:financialAccountId',
    permission: 'banking.accounts.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/financial-accounts',
    permission: 'banking.accounts.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/financial-accounts/:financialAccountId',
    permission: 'banking.accounts.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/financial-accounts',
    permission: 'banking.accounts.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reconciliations/:reconciliationId',
    permission: 'banking.reconciliations.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/reconciliations',
    permission: 'banking.reconciliations.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/reconciliations/:reconciliationId/clear',
    permission: 'banking.reconciliations.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/reconciliations/:reconciliationId/complete',
    permission: 'banking.reconciliations.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/reconciliations/:reconciliationId/reopen',
    permission: 'banking.reconciliations.reopen',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/reconciliations/:reconciliationId/unclear',
    permission: 'banking.reconciliations.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/reconciliations',
    permission: 'banking.reconciliations.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/statement-imports/:statementImportId/failed-rows',
    permission: 'banking.transactions.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/statement-imports/:statementImportId',
    permission: 'banking.transactions.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/statement-imports',
    permission: 'banking.transactions.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/statement-imports',
    permission: 'banking.transactions.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/transfers/:transferId',
    permission: 'banking.transfers.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/transfers',
    permission: 'banking.transfers.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/transfers/:transferId/void',
    permission: 'banking.transfers.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/transfers',
    permission: 'banking.transfers.manage',
  },

  // --- Phase 6: Inventory ---
  {
    method: 'get',
    path: 'organizations/:organizationId/inventory/adjustments',
    permission: 'inventory.adjustments.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/inventory/movements',
    permission: 'inventory.movements.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/inventory/reorder',
    permission: 'inventory.reorder.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/inventory/valuation',
    permission: 'inventory.valuation.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/inventory/warehouses',
    permission: 'inventory.warehouses.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/inventory/adjustments/:adjustmentId',
    permission: 'inventory.adjustments.manage',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/inventory/warehouses/:warehouseId',
    permission: 'inventory.warehouses.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/inventory/adjustments/:adjustmentId/approve',
    permission: 'inventory.adjustments.approve',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/inventory/adjustments/:adjustmentId/cancel',
    permission: 'inventory.adjustments.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/inventory/adjustments/:adjustmentId/post',
    permission: 'inventory.adjustments.post',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/inventory/adjustments/:adjustmentId/submit',
    permission: 'inventory.adjustments.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/inventory/adjustments',
    permission: 'inventory.adjustments.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/inventory/transfers',
    permission: 'inventory.transfers.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/inventory/warehouses',
    permission: 'inventory.warehouses.manage',
  },

  // --- Phase 7: Projects & Time ---
  //
  // The literal `time-entries`, `expenses`, and `tasks` segments are declared by the controller
  // above its `:projectId` routes, so Nest matches them as literals rather than capturing them as
  // project ids. The declaration order here does not matter -- the sync check sorts -- but the
  // grouping mirrors the controller so the two stay readable side by side.
  {
    method: 'get',
    path: 'organizations/:organizationId/projects/time-entries',
    permission: 'projects.time.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/time-entries',
    permission: 'projects.time.manage',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/projects/time-entries/:timeEntryId',
    permission: 'projects.time.manage',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/projects/time-entries/:timeEntryId',
    permission: 'projects.time.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/time-entries/submit',
    permission: 'projects.time.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/time-entries/approve',
    permission: 'projects.time.approve',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/time-entries/reject',
    permission: 'projects.time.approve',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/time-entries/unlock',
    permission: 'projects.time.approve',
    body: {},
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/projects/expenses/:projectExpenseId',
    permission: 'projects.expenses.manage',
    body: {},
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/projects/expenses/:projectExpenseId',
    permission: 'projects.expenses.manage',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/projects/tasks/:taskId',
    permission: 'projects.manage',
    body: {},
  },
  { method: 'get', path: 'organizations/:organizationId/projects', permission: 'projects.view' },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects',
    permission: 'projects.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/projects/:projectId',
    permission: 'projects.view',
  },
  {
    method: 'patch',
    path: 'organizations/:organizationId/projects/:projectId',
    permission: 'projects.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/:projectId/status',
    permission: 'projects.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/projects/:projectId/tasks',
    permission: 'projects.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/:projectId/tasks',
    permission: 'projects.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/projects/:projectId/budgets',
    permission: 'projects.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/:projectId/budgets',
    permission: 'projects.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/projects/:projectId/expenses',
    permission: 'projects.view',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/:projectId/expenses',
    permission: 'projects.expenses.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/projects/:projectId/billables',
    permission: 'projects.billing.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/projects/:projectId/generate-invoice',
    permission: 'projects.billing.manage',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/projects/:projectId/profitability',
    permission: 'projects.profitability.view',
  },
  // Phase 11 -- portal access management and the generic collaboration surface. The collaboration
  // reads carry no permission of their own: the target registry resolves the parent document's
  // view permission per target type, and a caller without it gets the same not-found answer as one
  // asking about a document that does not exist.
  {
    method: 'get',
    path: 'organizations/:organizationId/customers/:contactId/portal-users',
    permission: 'portal.access.manage',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/customers/:contactId/portal-invitations',
    permission: 'portal.access.manage',
    body: {},
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/portal-invitations/:invitationId/resend',
    permission: 'portal.access.manage',
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/portal-invitations/:invitationId',
    permission: 'portal.access.manage',
  },
  {
    method: 'delete',
    path: 'organizations/:organizationId/portal-users/:portalUserId',
    permission: 'portal.access.manage',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/collaboration/:targetType/:targetId/comments',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/collaboration/:targetType/:targetId/comments',
    permission: 'collaboration.comments.create',
    body: {},
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/collaboration/:targetType/:targetId/attachments',
  },
  {
    method: 'post',
    path: 'organizations/:organizationId/collaboration/:targetType/:targetId/attachments',
    permission: 'collaboration.attachments.upload',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/collaboration/:targetType/:targetId/attachments/:attachmentId/download',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/collaboration/:targetType/:targetId/activity',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/bills/:billId/attachments/:attachmentId/download',
    permission: 'purchases.bills.view',
  },
  {
    method: 'get',
    path: 'organizations/:organizationId/expenses/:expenseId/attachments/:attachmentId/download',
    permission: 'purchases.expenses.view',
  },
];

/**
 * Every organization-scoped controller, read off the booted Nest module graph rather than a
 * hand-maintained list. Phases 5 and 6 shipped with their controllers missing from the old
 * hardcoded array, and the sync check below could not see it: it compared that array against a
 * declared list, so a controller absent from BOTH was invisible. Deriving from the container
 * means a new controller shows up here the moment it is registered, and the sync check fails
 * until its endpoints are declared in ENDPOINTS.
 */
function registeredControllers(app: INestApplication): Type[] {
  const controllers: Type[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      if (typeof wrapper.metatype === 'function') controllers.push(wrapper.metatype as Type);
    }
  }
  return controllers;
}

describe('organization authorization boundary over HTTP', () => {
  let harness: TestHarness;
  let organizations: OrganizationService;
  let access: OrganizationAccessService;
  let organizationId: string;
  let otherOrganizationId: string;
  let owner: PublicUser;
  let ownerMemberId: string;
  let adminRoleId: string;
  let actors: Map<SystemRoleKey, { cookie: string; permissions: Set<string> }>;

  beforeAll(async () => {
    harness = await createTestHarness();
    organizations = harness.app.get(OrganizationService);
    access = harness.app.get(OrganizationAccessService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    owner = await createUser('boundary-owner@example.test', 'Boundary Owner');
    organizationId = await createActiveOrganization(owner, 'Authorization Matrix Ltd');
    actors = new Map();

    const roles = await harness.prisma.role.findMany({
      where: { organizationId },
      include: { permissions: true },
    });
    for (const roleKey of SYSTEM_ROLE_KEYS) {
      const role = roles.find((candidate) => candidate.key === roleKey);
      if (!role) throw new Error(`Missing system role ${roleKey}.`);
      const user =
        roleKey === 'OWNER'
          ? owner
          : await createUser(
              `${roleKey.toLowerCase().replaceAll('_', '-')}@example.test`,
              role.name,
            );
      if (roleKey !== 'OWNER') {
        await harness.prisma.organizationMember.create({
          data: { organizationId, userId: user.id, roleId: role.id, status: 'ACTIVE' },
        });
      }
      actors.set(roleKey, {
        cookie: await sessionCookieFor(user.id),
        permissions: new Set(role.permissions.map((permission) => permission.permissionKey)),
      });
    }

    ownerMemberId = (
      await harness.prisma.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: owner.id } },
      })
    ).id;
    adminRoleId = roles.find((role) => role.key === 'ADMIN')?.id ?? '';

    const otherOwner = await createUser('other-owner@example.test', 'Other Owner');
    otherOrganizationId = await createActiveOrganization(otherOwner, 'Other Tenant Ltd');
  });

  it('keeps the declared matrix synchronized with every organization-scoped controller route and guard', () => {
    const discovered = discoverOrganizationEndpoints(registeredControllers(harness.app));
    expect(normalizeEndpoints(ENDPOINTS)).toEqual(normalizeEndpoints(discovered));
  });

  it('enforces the eight-role permission matrix on every organization-scoped endpoint', async () => {
    for (const [roleKey, actor] of actors) {
      for (const endpoint of ENDPOINTS) {
        const response = await requestEndpoint(actor.cookie, endpoint, organizationId);
        const allowed = !endpoint.permission || actor.permissions.has(endpoint.permission);
        const description = `${roleKey} ${endpoint.method.toUpperCase()} ${endpoint.path} (${endpoint.permission ?? 'membership'})`;
        if (allowed) {
          expect(response.status, description).not.toBe(403);
          expect(response.status, description).not.toBe(401);
        } else {
          expect(response.status, description).toBe(403);
        }
      }
    }
    // The endpoint list nearly doubled in Phase 3 (~180 endpoints x 8 roles of real HTTP calls),
    // which no longer fits the 30s default -- give the full matrix sweep explicit headroom.
  }, 240_000);

  it('returns the same not-found envelope for another tenant and an unknown tenant on every endpoint', async () => {
    const ownerActor = required(actors.get('OWNER'), 'Owner actor is missing.');
    for (const endpoint of ENDPOINTS) {
      const crossTenant = await requestEndpoint(ownerActor.cookie, endpoint, otherOrganizationId);
      const unknown = await requestEndpoint(ownerActor.cookie, endpoint, UNKNOWN_ORGANIZATION);
      expect(crossTenant.status, `${endpoint.method} ${endpoint.path}`).toBe(404);
      expect(unknown.status, `${endpoint.method} ${endpoint.path}`).toBe(404);
      expect(crossTenant.body).toEqual(unknown.body);
    }
  });

  it('rejects protected permissions when creating a custom role through HTTP', async () => {
    const ownerActor = required(actors.get('OWNER'), 'Owner actor is missing.');
    for (const permission of ['organization.finalize', 'roles.manage'] as const) {
      await harness
        .http()
        .post(`${API}/organizations/${organizationId}/roles`)
        .set('Cookie', ownerActor.cookie)
        .send({ name: `Escalator ${permission}`, permissions: [permission] })
        .expect(400);
    }
  });

  it('keeps the owner unremovable and unreassignable through HTTP', async () => {
    const ownerActor = required(actors.get('OWNER'), 'Owner actor is missing.');
    await harness
      .http()
      .patch(`${API}/organizations/${organizationId}/members/${ownerMemberId}`)
      .set('Cookie', ownerActor.cookie)
      .send({ roleId: adminRoleId })
      .expect(400);
    await harness
      .http()
      .delete(`${API}/organizations/${organizationId}/members/${ownerMemberId}`)
      .set('Cookie', ownerActor.cookie)
      .expect(400);
  });

  it('grants audit viewing only to the four intended system roles', async () => {
    const granted = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER'] as const;
    const denied = ['SALES', 'PURCHASES', 'INVENTORY_MANAGER', 'PROJECT_MANAGER'] as const;
    for (const role of granted) {
      await harness
        .http()
        .get(`${API}/organizations/${organizationId}/audit-log`)
        .set('Cookie', required(actors.get(role), `${role} actor is missing.`).cookie)
        .expect(200);
    }
    for (const role of denied) {
      await harness
        .http()
        .get(`${API}/organizations/${organizationId}/audit-log`)
        .set('Cookie', required(actors.get(role), `${role} actor is missing.`).cookie)
        .expect(403);
    }
  });

  async function createUser(email: string, displayName: string): Promise<PublicUser> {
    const user = await harness.prisma.user.create({
      data: { email, displayName, emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
      status: user.status,
    };
  }

  async function createActiveOrganization(user: PublicUser, legalName: string): Promise<string> {
    const created = await organizations.create(
      user,
      { legalName, businessType: 'LIMITED_COMPANY', countryCode: 'KE' },
      metadata,
    );
    const context = await access.requireMembership(user.id, created.id);
    await organizations.finalize(context, user, metadata);
    return created.id;
  }

  async function sessionCookieFor(userId: string): Promise<string> {
    const rawToken = createOpaqueToken();
    await harness.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        userAgent: metadata.userAgent,
        ipHash: metadata.ipHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return `rb_session=${rawToken}`;
  }

  async function requestEndpoint(cookie: string, endpoint: EndpointCase, tenantId: string) {
    const path = `${API}/${endpoint.path}`
      .replace(':organizationId', tenantId)
      .replace(':memberId', ID)
      .replace(':invitationId', ID)
      .replace(':roleId', ID)
      .replace(':periodId', ID)
      .replace(':currencyCode', 'USD')
      .replace(':accountId', ID)
      .replace(':journalId', ID)
      .replace(':taxCodeId', ID)
      .replace(':documentType', 'INVOICE')
      .replace(':contactId', ID)
      .replace(':unitId', ID)
      .replace(':categoryId', ID)
      .replace(':itemId', ID)
      .replace(':invoiceId', ID)
      .replace(':paymentId', ID)
      .replace(':creditNoteId', ID)
      .replace(':quoteId', ID)
      .replace(':orderId', ID)
      .replace(':templateId', ID)
      .replace(':vendorId', ID)
      .replace(':billId', ID)
      .replace(':expenseId', ID)
      .replace(':vendorCreditId', ID)
      .replace(':batchId', ID)
      .replace(':projectId', ID)
      .replace(':timeEntryId', ID)
      .replace(':projectExpenseId', ID)
      .replace(':taskId', ID)
      .replace(':requestId', ID)
      .replace(':executionId', ID)
      .replace(':policyId', ID)
      .replace(':ruleId', ID)
      .replace(':notificationId', ID)
      .replace(':scheduledReportId', ID)
      .replace(':targetType', 'INVOICE')
      .replace(':targetId', ID)
      .replace(':attachmentId', ID)
      .replace(':portalUserId', ID);
    const test = harness.http()[endpoint.method](path).set('Cookie', cookie);
    if (endpoint.body !== undefined) test.send(endpoint.body);
    return test;
  }
});

function discoverOrganizationEndpoints(controllers: readonly Type[]): EndpointCase[] {
  const endpoints: EndpointCase[] = [];
  for (const controller of controllers) {
    const basePath = metadataValue<string>(PATH_METADATA, controller) ?? '';
    const classGuards = metadataValue<unknown[]>(GUARDS_METADATA, controller) ?? [];
    const prototype = controller.prototype as object;
    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === 'constructor') continue;
      const handler = Object.getOwnPropertyDescriptor(prototype, methodName)?.value as unknown;
      if (typeof handler !== 'function') continue;
      const routePath = metadataValue<string>(PATH_METADATA, handler);
      const requestMethod = metadataValue<RequestMethod>(METHOD_METADATA, handler);
      if (routePath === undefined || requestMethod === undefined) continue;

      const fullPath = [basePath, routePath]
        .filter(Boolean)
        .join('/')
        .replace(/\/{2,}/g, '/')
        .replace(/\/$/, '');
      if (!fullPath.includes(':organizationId')) continue;
      const handlerGuards = metadataValue<unknown[]>(GUARDS_METADATA, handler) ?? [];
      expect(
        [...classGuards, ...handlerGuards].includes(OrganizationGuard),
        `${controller.name}.${methodName} is organization-scoped but lacks OrganizationGuard`,
      ).toBe(true);

      const method = RequestMethod[requestMethod]?.toLowerCase();
      if (!isHttpMethod(method)) throw new Error(`Unsupported request method on ${fullPath}.`);
      const permission = metadataValue<PermissionKey>(PERMISSION_KEY, handler);
      endpoints.push({ method, path: fullPath, ...(permission ? { permission } : {}) });
    }
  }
  return endpoints;
}

function metadataValue<T>(key: string, target: object): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined;
}

function normalizeEndpoints(endpoints: readonly EndpointCase[]): string[] {
  return endpoints
    .map(
      (endpoint) =>
        `${endpoint.method.toUpperCase()} ${endpoint.path} ${endpoint.permission ?? 'MEMBERSHIP'}`,
    )
    .sort();
}

function isHttpMethod(value: string | undefined): value is HttpMethod {
  return value === 'get' || value === 'post' || value === 'patch' || value === 'delete';
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
