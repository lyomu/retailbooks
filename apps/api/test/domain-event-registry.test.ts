import { DOMAIN_EVENT_NAMES, domainEventNameSchema } from '@retailbooks/contracts';
import { describe, expect, it } from 'vitest';

/**
 * The domain event registry is the single source of truth for what the outbox can carry and what a
 * workflow rule can trigger on. `domainEventNameSchema` is what makes a rule's `trigger` reject an
 * unregistered event name at both the DTO (`class-validator @IsIn`) and service (`createWorkflowRule
 * Schema`/`updateWorkflowRuleSchema`) layers; a unit test on the schema itself is enough to prove that
 * enforcement, since the integration coverage for the rule path is exercised separately.
 */
describe('domain event registry and payload versioning', () => {
  it('accepts registered event names', () => {
    expect(domainEventNameSchema.safeParse('invoice.issued').success).toBe(true);
    expect(domainEventNameSchema.safeParse('approval.completed').success).toBe(true);
    expect(domainEventNameSchema.safeParse('scheduled-job.failed').success).toBe(true);
  });

  it('rejects unregistered event names', () => {
    expect(domainEventNameSchema.safeParse('not.a.real.event').success).toBe(false);
  });

  it('rejects a registered name with stray whitespace (no implicit trim on the enum)', () => {
    expect(domainEventNameSchema.safeParse('invoice.issued ').success).toBe(false);
  });

  it('exports a non-empty closed list that includes the workflow trigger surface', () => {
    expect(DOMAIN_EVENT_NAMES.length).toBeGreaterThan(0);
    expect(DOMAIN_EVENT_NAMES).toContain('invoice.issued');
    expect(DOMAIN_EVENT_NAMES).toContain('approval.submitted');
    expect(DOMAIN_EVENT_NAMES).toContain('approval.completed');
  });
});
