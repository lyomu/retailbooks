export const AUTOMATION_QUEUE_NAME = 'automation';

export const AUTOMATION_JOB_NAMES = {
  domainEvent: 'domain-event',
  scheduledExecution: 'scheduled-execution',
} as const;

export type AutomationJobName = (typeof AUTOMATION_JOB_NAMES)[keyof typeof AUTOMATION_JOB_NAMES];

export type DomainEventJob = { eventId: string };
export type ScheduledExecutionJob = { executionId: string };

export type AutomationJob = DomainEventJob | ScheduledExecutionJob;
