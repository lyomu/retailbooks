import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, WorkflowRuleStatus, WorkflowRunStatus, type Prisma } from '@prisma/client';
import {
  createWorkflowRuleSchema,
  updateWorkflowRuleSchema,
  workflowActionSchema,
  workflowConditionSchema,
  type WorkflowAction,
  type WorkflowCondition,
} from '@retailbooks/contracts';

import type { PublicUser } from '../auth/auth.service.js';
import type { RequestMetadata } from '../auth/request-context.js';
import { redactUrl } from '../common/logging/redact.js';
import { PrismaService } from '../database/prisma.service.js';
import { writeAuditEvent } from '../organizations/audit-event.js';
import { OrganizationAccessService } from '../organizations/organization-access.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { DomainEventsService } from './domain-events.service.js';
import { NotificationsService } from './notifications.service.js';
import type { CreateWorkflowRuleDto, UpdateWorkflowRuleDto } from './workflow.dto.js';

const MAX_RULES_PER_EVENT = 25;

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationAccess: OrganizationAccessService,
    private readonly notifications: NotificationsService,
    private readonly events: DomainEventsService,
  ) {}

  async list(organizationId: string) {
    return this.prisma.workflowRule.findMany({
      where: { organizationId },
      orderBy: [{ trigger: 'asc' }, { name: 'asc' }],
    });
  }

  async create(
    context: OrganizationContext,
    user: PublicUser,
    input: CreateWorkflowRuleDto,
    metadata: RequestMetadata,
  ) {
    const parsed = createWorkflowRuleSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.workflowRule.create({
        data: {
          organizationId: context.id,
          createdByUserId: user.id,
          name: parsed.data.name,
          trigger: parsed.data.trigger,
          /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with
             this rule here (both fields, though eslint's own check only ever agrees on one of the
             two at a time depending on unrelated edits): `WorkflowCondition.value` is `unknown` and
             `WorkflowAction` is a discriminated union, and Prisma's structural JSON check for
             `InputJsonValue` needs both assertions even though both values are JSON-safe at runtime. */
          conditions: parsed.data.conditions as Prisma.InputJsonValue,
          actions: parsed.data.actions as Prisma.InputJsonValue,
          /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.workflow_rule_created',
        entityType: 'workflow_rule',
        entityId: rule.id,
        action: AuditAction.CREATE,
        after: { trigger: rule.trigger, name: rule.name },
        ipHash: metadata.ipHash,
      });
      return rule;
    });
  }

  /** Editing a live rule mid-flight would change what an already-approved-looking rule actually
   * does, so -- mirroring `ApprovalsService#updatePolicy` -- edits are only allowed while the rule
   * is not `ACTIVE`. */
  async updateRule(
    context: OrganizationContext,
    user: PublicUser,
    ruleId: string,
    input: UpdateWorkflowRuleDto,
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.workflowRule.findFirst({
      where: { id: ruleId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Workflow rule not found.');
    if (existing.status === WorkflowRuleStatus.ACTIVE) {
      throw new ConflictException('Deactivate a workflow rule before changing it.');
    }
    const parsed = updateWorkflowRuleSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.workflowRule.update({
        where: { id: ruleId },
        data: {
          name: parsed.data.name,
          trigger: parsed.data.trigger,
          /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- see the matching
             comment in `create` above. */
          conditions: parsed.data.conditions as Prisma.InputJsonValue | undefined,
          actions: parsed.data.actions as Prisma.InputJsonValue | undefined,
          /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */
          version: { increment: 1 },
        },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey: 'automation.workflow_rule_updated',
        entityType: 'workflow_rule',
        entityId: rule.id,
        action: AuditAction.UPDATE,
        before: { name: existing.name, trigger: existing.trigger, version: existing.version },
        after: { name: rule.name, trigger: rule.trigger, version: rule.version },
        ipHash: metadata.ipHash,
      });
      return rule;
    });
  }

  /**
   * Evaluates a rule's conditions against a caller-supplied sample payload with no persistence and
   * no actions executed -- a preview of whether a given event would fire the rule, and which
   * conditions decided that, before it is ever activated against real events.
   */
  async dryRun(organizationId: string, ruleId: string, payload: Record<string, unknown>) {
    const rule = await this.prisma.workflowRule.findFirst({
      where: { id: ruleId, organizationId },
    });
    if (!rule) throw new NotFoundException('Workflow rule not found.');
    const jsonPayload = payload as Prisma.JsonValue;
    const conditions = parseConditions(rule.conditions);
    const conditionResults = conditions.map((condition) => ({
      field: condition.field,
      operator: condition.operator,
      value: condition.value,
      matched: conditionMatches(condition, jsonPayload),
    }));
    const matched = conditionResults.every((result) => result.matched);
    return {
      trigger: rule.trigger,
      matched,
      conditionResults,
      actionsPreview: matched
        ? parseActions(rule.actions).map((action) => previewAction(action, payload))
        : [],
    };
  }

  /** Most recent runs for one rule -- the "why didn't/did this fire" view alongside dry-run. */
  async listRuns(organizationId: string, ruleId: string, limit = 100) {
    const rule = await this.prisma.workflowRule.findFirst({
      where: { id: ruleId, organizationId },
      select: { id: true },
    });
    if (!rule) throw new NotFoundException('Workflow rule not found.');
    return this.prisma.workflowRun.findMany({
      where: { organizationId, ruleId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async setStatus(
    context: OrganizationContext,
    user: PublicUser,
    ruleId: string,
    status: 'ACTIVE' | 'INACTIVE',
    metadata: RequestMetadata,
  ) {
    const existing = await this.prisma.workflowRule.findFirst({
      where: { id: ruleId, organizationId: context.id },
    });
    if (!existing) throw new NotFoundException('Workflow rule not found.');
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.workflowRule.update({
        where: { id: ruleId },
        data: { status, version: { increment: 1 } },
      });
      await writeAuditEvent(tx, {
        organizationId: context.id,
        actorUserId: user.id,
        eventKey:
          status === WorkflowRuleStatus.ACTIVE
            ? 'automation.workflow_rule_activated'
            : 'automation.workflow_rule_deactivated',
        entityType: 'workflow_rule',
        entityId: rule.id,
        action: AuditAction.UPDATE,
        before: { status: existing.status, version: existing.version },
        after: { status: rule.status, version: rule.version },
        ipHash: metadata.ipHash,
      });
      return rule;
    });
  }

  /** A unique `(rule,event)` row prevents worker replay from reapplying an action. */
  async consumeEvent(eventId: string): Promise<void> {
    const event = await this.events.findDispatched(eventId);
    if (!event) return;
    const rules = await this.prisma.workflowRule.findMany({
      where: {
        organizationId: event.organizationId,
        trigger: event.eventName,
        status: WorkflowRuleStatus.ACTIVE,
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_RULES_PER_EVENT,
    });
    for (const rule of rules) await this.runRule(event, rule);
  }

  private async runRule(
    event: { id: string; organizationId: string; payload: Prisma.JsonValue },
    rule: Prisma.WorkflowRuleGetPayload<Record<string, never>>,
  ) {
    try {
      await this.organizationAccess.requireMembership(rule.createdByUserId, event.organizationId);
    } catch {
      await this.createSkippedRun(
        rule.id,
        event.id,
        event.organizationId,
        'Rule creator has no active organization access.',
        rule.version,
      );
      return;
    }
    if (
      !parseConditions(rule.conditions).every((condition) =>
        conditionMatches(condition, event.payload),
      )
    ) {
      await this.createSkippedRun(
        rule.id,
        event.id,
        event.organizationId,
        'Conditions did not match.',
        rule.version,
      );
      return;
    }
    // The RUNNING row is created and committed on its own -- outside the transaction that executes
    // the rule's actions -- so a later action failure rolls back only the actions, never the record
    // that this rule was attempted at all. Its (ruleId, eventId) uniqueness is what makes re-entry
    // (a BullMQ retry replaying the same event) idempotent: a second attempt hits this insert and is
    // treated as already-run, never as a second RUNNING row.
    let run: { id: string };
    try {
      run = await this.prisma.workflowRun.create({
        data: {
          organizationId: event.organizationId,
          ruleId: rule.id,
          eventId: event.id,
          status: WorkflowRunStatus.RUNNING,
          startedAt: new Date(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      throw error;
    }
    try {
      const actions = parseActions(rule.actions);
      await this.prisma.$transaction(async (tx) => {
        for (const action of actions) {
          if (action.type === 'CREATE_NOTIFICATION') {
            await this.notifications.create(tx, {
              organizationId: event.organizationId,
              recipientUserId: action.recipientUserId,
              eventKey: `automation.rule.${rule.id}`,
              title: interpolate(action.title, event.payload),
              body: action.body ? interpolate(action.body, event.payload) : undefined,
              href: action.href,
              metadata: { eventId: event.id, ruleId: rule.id },
            });
          } else {
            await tx.automationTask.create({
              data: {
                organizationId: event.organizationId,
                sourceEventId: event.id,
                title: interpolate(action.title, event.payload),
                detail: action.detail ? interpolate(action.detail, event.payload) : undefined,
                assignedToUserId: action.assignedToUserId,
              },
            });
          }
        }
        await tx.workflowRun.update({
          where: { id: run.id },
          data: {
            status: WorkflowRunStatus.SUCCEEDED,
            completedAt: new Date(),
            result: { actions: actions.length, ruleVersion: rule.version },
          },
        });
      });
    } catch (error) {
      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: WorkflowRunStatus.FAILED,
          completedAt: new Date(),
          result: { ruleVersion: rule.version },
          error: redactedErrorMessage(error),
        },
      });
      throw error;
    }
  }

  private async createSkippedRun(
    ruleId: string,
    eventId: string,
    organizationId: string,
    reason: string,
    ruleVersion?: number,
  ) {
    try {
      await this.prisma.workflowRun.create({
        data: {
          organizationId,
          ruleId,
          eventId,
          status: WorkflowRunStatus.SKIPPED,
          result: { reason, ruleVersion },
          completedAt: new Date(),
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
}

function parseConditions(value: Prisma.JsonValue): WorkflowCondition[] {
  if (!Array.isArray(value)) return [];
  return value.map((condition) => workflowConditionSchema.parse(condition));
}

function parseActions(value: Prisma.JsonValue): WorkflowAction[] {
  if (!Array.isArray(value)) throw new BadRequestException('Workflow rule actions are invalid.');
  return value.map((action) => workflowActionSchema.parse(action));
}

function conditionMatches(condition: WorkflowCondition, payload: Prisma.JsonValue): boolean {
  const value =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)[condition.field]
      : undefined;
  if (condition.operator === 'exists') return value !== undefined && value !== null;
  if (condition.operator === 'equals')
    return JSON.stringify(value) === JSON.stringify(condition.value);
  if (condition.operator === 'notEquals')
    return JSON.stringify(value) !== JSON.stringify(condition.value);
  if (condition.operator === 'in')
    return (
      Array.isArray(condition.value) &&
      condition.value.some((item) => JSON.stringify(item) === JSON.stringify(value))
    );
  if (condition.operator === 'greaterThan')
    return (
      typeof value === 'number' && typeof condition.value === 'number' && value > condition.value
    );
  if (condition.operator === 'lessThan')
    return (
      typeof value === 'number' && typeof condition.value === 'number' && value < condition.value
    );
  return false;
}

function interpolate(template: string, payload: Prisma.JsonValue): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return template;
  const values = payload as Record<string, unknown>;
  return template.replaceAll(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key: string) =>
    stringifyValue(values[key]),
  );
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Renders what an action would actually say/do against the dry-run's sample payload, unexecuted. */
function previewAction(action: WorkflowAction, payload: Record<string, unknown>) {
  const jsonPayload = payload as Prisma.JsonValue;
  if (action.type === 'CREATE_NOTIFICATION') {
    return {
      type: action.type,
      recipientUserId: action.recipientUserId,
      title: interpolate(action.title, jsonPayload),
      body: action.body ? interpolate(action.body, jsonPayload) : undefined,
    };
  }
  return {
    type: action.type,
    title: interpolate(action.title, jsonPayload),
    detail: action.detail ? interpolate(action.detail, jsonPayload) : undefined,
    assignedToUserId: action.assignedToUserId,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** Message only, never a stack trace, with any embedded URL's sensitive query values stripped. */
function redactedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const scrubbed = message.replace(/https?:\/\/\S+/g, (url) => redactUrl(url));
  return scrubbed.slice(0, 2_000);
}
