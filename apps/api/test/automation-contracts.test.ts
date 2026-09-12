import { describe, expect, it } from 'vitest';

import {
  approvalConditionsSchema,
  createReminderPolicySchema,
  createScheduledReportSchema,
  reminderPolicyOffsetSchema,
  reminderPolicySchema,
  scheduledJobExecutionSchema,
  submitApprovalRequestSchema,
  updateReminderPolicySchema,
  workflowActionSchema,
  workflowConditionSchema,
} from '@retailbooks/contracts';

/**
 * DB-free contract tests for the Phase 10 automation envelopes that were tracked debt (GAP #18):
 * ReminderPolicy, ScheduledJobExecution, plus the existing workflow/approval/schedule/notification
 * discriminated unions that must keep accepting valid input and rejecting invalid input.
 */
describe('Phase 10 automation contract schemas (GAP #18)', () => {
  describe('reminderPolicyOffsetSchema', () => {
    it('accepts a valid BEFORE_DUE offset', () => {
      const result = reminderPolicyOffsetSchema.safeParse({ days: -3, type: 'BEFORE_DUE' });
      expect(result.success).toBe(true);
    });

    it('accepts an ON_DUE offset', () => {
      const result = reminderPolicyOffsetSchema.safeParse({ days: 0, type: 'ON_DUE' });
      expect(result.success).toBe(true);
    });

    it('accepts an OVERDUE offset', () => {
      const result = reminderPolicyOffsetSchema.safeParse({ days: 7, type: 'OVERDUE' });
      expect(result.success).toBe(true);
    });

    it('rejects an out-of-range day value', () => {
      const result = reminderPolicyOffsetSchema.safeParse({ days: 999, type: 'OVERDUE' });
      expect(result.success).toBe(false);
    });

    it('rejects an invalid offset type', () => {
      const result = reminderPolicyOffsetSchema.safeParse({ days: 1, type: 'DURING_DUE' });
      expect(result.success).toBe(false);
    });
  });

  describe('createReminderPolicySchema', () => {
    it('accepts a fully valid create input', () => {
      const result = createReminderPolicySchema.safeParse({
        name: 'Net-30 overdue reminders',
        offsets: [
          { days: -2, type: 'BEFORE_DUE' },
          { days: 0, type: 'ON_DUE' },
          { days: 7, type: 'OVERDUE' },
        ],
        subject: 'Invoice {{invoiceNumber}} is {{dueLabel}}',
        bodyTemplate:
          'Hi {{customerName}}, invoice {{invoiceNumber}} for {{amount}} is {{dueLabel}}.',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an empty offsets array', () => {
      const result = createReminderPolicySchema.safeParse({
        name: 'No offsets',
        offsets: [],
        subject: 'Subject',
        bodyTemplate: 'Body',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty name', () => {
      const result = createReminderPolicySchema.safeParse({
        name: '   ',
        offsets: [{ days: 0, type: 'ON_DUE' }],
        subject: 'Subject',
        bodyTemplate: 'Body',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateReminderPolicySchema', () => {
    it('accepts a partial update', () => {
      const result = updateReminderPolicySchema.safeParse({ name: 'Renamed' });
      expect(result.success).toBe(true);
    });

    it('accepts an empty object (no-op update)', () => {
      const result = updateReminderPolicySchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('reminderPolicySchema (response shape)', () => {
    it('accepts a full persisted reminder policy', () => {
      const result = reminderPolicySchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Net-30',
        offsets: [{ days: 0, type: 'ON_DUE' }],
        subject: 'Due',
        bodyTemplate: 'Body',
        active: true,
        createdAt: '2026-09-12T10:00:00.000Z',
        updatedAt: '2026-09-12T10:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a missing active flag', () => {
      const result = reminderPolicySchema.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        organizationId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Net-30',
        offsets: [],
        subject: 'Due',
        bodyTemplate: 'Body',
        createdAt: '2026-09-12T10:00:00.000Z',
        updatedAt: '2026-09-12T10:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });
  });
  describe('scheduledJobExecutionSchema', () => {
    it('accepts a completed execution record', () => {
      const result = scheduledJobExecutionSchema.safeParse({
        id: '660e8400-e29b-41d4-a716-446655440000',
        organizationId: '660e8400-e29b-41d4-a716-446655440001',
        scheduledJobId: '660e8400-e29b-41d4-a716-446655440002',
        occurrenceKey: '2026-09-12T00:00:00.000Z',
        status: 'COMPLETED',
        attempts: 1,
        startedAt: '2026-09-12T00:00:01.000Z',
        completedAt: '2026-09-12T00:00:02.000Z',
        error: null,
        result: { enqueued: true },
        createdAt: '2026-09-12T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a failed execution with an error message', () => {
      const result = scheduledJobExecutionSchema.safeParse({
        id: '660e8400-e29b-41d4-a716-446655440000',
        organizationId: '660e8400-e29b-41d4-a716-446655440001',
        scheduledJobId: '660e8400-e29b-41d4-a716-446655440002',
        occurrenceKey: '2026-09-12T00:00:00.000Z',
        status: 'FAILED',
        attempts: 3,
        startedAt: '2026-09-12T00:00:01.000Z',
        completedAt: null,
        error: 'Connection refused',
        result: {},
        createdAt: '2026-09-12T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown status', () => {
      const result = scheduledJobExecutionSchema.safeParse({
        id: '660e8400-e29b-41d4-a716-446655440000',
        organizationId: '660e8400-e29b-41d4-a716-446655440001',
        scheduledJobId: '660e8400-e29b-41d4-a716-446655440002',
        occurrenceKey: '2026-09-12T00:00:00.000Z',
        status: 'PENDING',
        attempts: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        result: {},
        createdAt: '2026-09-12T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('workflowActionSchema discriminated union', () => {
    it('accepts a CREATE_NOTIFICATION action', () => {
      const result = workflowActionSchema.safeParse({
        type: 'CREATE_NOTIFICATION',
        recipientUserId: '770e8400-e29b-41d4-a716-446655440000',
        title: 'Invoice issued',
        body: 'INV-001 was issued.',
        href: '/invoices/123',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a CREATE_TASK action', () => {
      const result = workflowActionSchema.safeParse({
        type: 'CREATE_TASK',
        title: 'Review invoice',
        detail: 'Please check the totals',
        assignedToUserId: '770e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown action type', () => {
      const result = workflowActionSchema.safeParse({
        type: 'SEND_SMS',
        phoneNumber: '+15551234567',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('workflowConditionSchema', () => {
    it('accepts an equals condition', () => {
      const result = workflowConditionSchema.safeParse({
        field: 'status',
        operator: 'equals',
        value: 'ISSUED',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown operator', () => {
      const result = workflowConditionSchema.safeParse({
        field: 'status',
        operator: 'contains',
        value: 'ISSUED',
      });
      expect(result.success).toBe(false);
    });
  });
  describe('approvalConditionsSchema (GAP #20: submitterRoles)', () => {
    it('accepts a submitterRoles array', () => {
      const result = approvalConditionsSchema.safeParse({
        submitterRoles: ['ADMIN', 'ACCOUNTANT'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts an empty conditions object', () => {
      const result = approvalConditionsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('rejects an empty role key in the array', () => {
      const result = approvalConditionsSchema.safeParse({
        submitterRoles: ['ADMIN', ''],
      });
      expect(result.success).toBe(false);
    });

    it('coexists with other conditions', () => {
      const result = approvalConditionsSchema.safeParse({
        minimumAmountMinor: '1000',
        maximumAmountMinor: '50000',
        submitterRoles: ['ADMIN'],
        submitterUserIds: ['880e8400-e29b-41d4-a716-446655440000'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('submitApprovalRequestSchema', () => {
    it('accepts a valid submission', () => {
      const result = submitApprovalRequestSchema.safeParse({
        targetType: 'INVOICE',
        targetId: '990e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an unknown target type', () => {
      const result = submitApprovalRequestSchema.safeParse({
        targetType: 'PAYROLL',
        targetId: '990e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createScheduledReportSchema', () => {
    it('accepts a valid scheduled report', () => {
      const result = createScheduledReportSchema.safeParse({
        name: 'Monthly P&L',
        savedReportId: '110e8400-e29b-41d4-a716-446655440000',
        recipientUserIds: ['110e8400-e29b-41d4-a716-446655440001'],
        format: 'pdf',
        schedule: { cadence: 'MONTHLY', localTime: '09:00' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects an invalid cadence', () => {
      const result = createScheduledReportSchema.safeParse({
        name: 'Monthly P&L',
        savedReportId: '110e8400-e29b-41d4-a716-446655440000',
        recipientUserIds: ['110e8400-e29b-41d4-a716-446655440001'],
        format: 'pdf',
        schedule: { cadence: 'BIWEEKLY', localTime: '09:00' },
      });
      expect(result.success).toBe(false);
    });
  });
});
