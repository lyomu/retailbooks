-- Phase 10: durable automation transport, scheduling, approvals, rules, and notifications.
-- Business documents retain their existing state machines; policy requests are an additive gate.

CREATE TYPE "DomainEventState" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');
CREATE TYPE "ApprovalPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');
CREATE TYPE "ApprovalTargetType" AS ENUM (
  'QUOTE', 'SALES_ORDER', 'INVOICE', 'CREDIT_NOTE', 'PURCHASE_ORDER', 'BILL',
  'PAYMENT_MADE', 'INVENTORY_ADJUSTMENT', 'JOURNAL'
);
CREATE TYPE "WorkflowRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "WorkflowRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');
CREATE TYPE "ScheduledJobStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED');
CREATE TYPE "ScheduledJobExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');
CREATE TYPE "ScheduledJobMisfirePolicy" AS ENUM ('CATCH_UP', 'RUN_ONCE', 'SKIP');
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ');

CREATE TABLE "domain_event_outbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "aggregate_type" VARCHAR(60) NOT NULL,
  "aggregate_id" VARCHAR(100) NOT NULL,
  "event_name" VARCHAR(100) NOT NULL,
  "event_version" SMALLINT NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "causation_id" UUID,
  "correlation_id" UUID,
  "state" "DomainEventState" NOT NULL DEFAULT 'PENDING',
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leased_at" TIMESTAMPTZ(6),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "dispatched_at" TIMESTAMPTZ(6),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "target_type" "ApprovalTargetType" NOT NULL,
  "status" "ApprovalPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "allow_self_approval" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_policy_steps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policy_id" UUID NOT NULL,
  "step_number" SMALLINT NOT NULL,
  "approver_user_id" UUID,
  "required_permission" VARCHAR(120),
  "label" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_policy_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "submitter_user_id" UUID NOT NULL,
  "target_type" "ApprovalTargetType" NOT NULL,
  "target_id" UUID NOT NULL,
  "target_version" TIMESTAMPTZ(6) NOT NULL,
  "target_snapshot" JSONB NOT NULL DEFAULT '{}',
  "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
  "current_step_number" SMALLINT NOT NULL DEFAULT 1,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_request_steps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "step_number" SMALLINT NOT NULL,
  "approver_user_id" UUID,
  "required_permission" VARCHAR(120),
  "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
  "decided_by_user_id" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_request_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "step_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "decision" "ApprovalStepStatus" NOT NULL,
  "comment" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "trigger" VARCHAR(100) NOT NULL,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "actions" JSONB NOT NULL DEFAULT '[]',
  "status" "WorkflowRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "status" "WorkflowRunStatus" NOT NULL DEFAULT 'PENDING',
  "result" JSONB NOT NULL DEFAULT '{}',
  "error" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "detail" TEXT,
  "source_event_id" UUID,
  "assigned_to_user_id" UUID,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scheduled_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "handler" VARCHAR(100) NOT NULL,
  "source_type" VARCHAR(60) NOT NULL,
  "source_id" UUID NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "schedule" JSONB NOT NULL DEFAULT '{}',
  "time_zone" VARCHAR(64) NOT NULL,
  "misfire_policy" "ScheduledJobMisfirePolicy" NOT NULL DEFAULT 'RUN_ONCE',
  "status" "ScheduledJobStatus" NOT NULL DEFAULT 'ACTIVE',
  "next_run_at" TIMESTAMPTZ(6) NOT NULL,
  "last_run_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scheduled_job_executions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "scheduled_job_id" UUID NOT NULL,
  "occurrence_key" VARCHAR(120) NOT NULL,
  "status" "ScheduledJobExecutionStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "error" TEXT,
  "result" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_job_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reminder_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "offsets" JSONB NOT NULL DEFAULT '[]',
  "subject" VARCHAR(240) NOT NULL,
  "body_template" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reminder_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scheduled_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "saved_report_id" UUID NOT NULL,
  "scheduled_job_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "format" VARCHAR(12) NOT NULL,
  "recipient_user_ids" JSONB NOT NULL DEFAULT '[]',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "last_artifact_key" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "event_key" VARCHAR(100) NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "body" TEXT,
  "href" VARCHAR(500),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
  "read_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "event_key" VARCHAR(100) NOT NULL,
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "email_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "domain_event_outbox_state_available_at_idx" ON "domain_event_outbox"("state", "available_at");
CREATE INDEX "domain_event_outbox_organization_id_created_at_idx" ON "domain_event_outbox"("organization_id", "created_at");
CREATE INDEX "domain_event_outbox_aggregate_type_aggregate_id_created_at_idx" ON "domain_event_outbox"("aggregate_type", "aggregate_id", "created_at");
CREATE UNIQUE INDEX "approval_policies_organization_id_name_key" ON "approval_policies"("organization_id", "name");
CREATE INDEX "approval_policies_organization_id_target_type_status_priori_idx" ON "approval_policies"("organization_id", "target_type", "status", "priority");
CREATE UNIQUE INDEX "approval_policy_steps_policy_id_step_number_key" ON "approval_policy_steps"("policy_id", "step_number");
CREATE INDEX "approval_policy_steps_approver_user_id_idx" ON "approval_policy_steps"("approver_user_id");
CREATE INDEX "approval_requests_organization_id_target_type_target_id_sta_idx" ON "approval_requests"("organization_id", "target_type", "target_id", "status");
CREATE INDEX "approval_requests_organization_id_submitter_user_id_status__idx" ON "approval_requests"("organization_id", "submitter_user_id", "status", "submitted_at");
CREATE UNIQUE INDEX "approval_request_steps_request_id_step_number_key" ON "approval_request_steps"("request_id", "step_number");
CREATE INDEX "approval_request_steps_approver_user_id_status_idx" ON "approval_request_steps"("approver_user_id", "status");
CREATE INDEX "approval_decisions_step_id_created_at_idx" ON "approval_decisions"("step_id", "created_at");
CREATE UNIQUE INDEX "workflow_rules_organization_id_name_key" ON "workflow_rules"("organization_id", "name");
CREATE INDEX "workflow_rules_organization_id_trigger_status_idx" ON "workflow_rules"("organization_id", "trigger", "status");
CREATE UNIQUE INDEX "workflow_runs_rule_id_event_id_key" ON "workflow_runs"("rule_id", "event_id");
CREATE INDEX "workflow_runs_organization_id_status_created_at_idx" ON "workflow_runs"("organization_id", "status", "created_at");
CREATE INDEX "automation_tasks_organization_id_assigned_to_user_id_comple_idx" ON "automation_tasks"("organization_id", "assigned_to_user_id", "completed_at");
CREATE UNIQUE INDEX "scheduled_jobs_organization_id_handler_source_type_source_i_key" ON "scheduled_jobs"("organization_id", "handler", "source_type", "source_id");
CREATE INDEX "scheduled_jobs_status_next_run_at_idx" ON "scheduled_jobs"("status", "next_run_at");
CREATE INDEX "scheduled_jobs_organization_id_status_next_run_at_idx" ON "scheduled_jobs"("organization_id", "status", "next_run_at");
CREATE UNIQUE INDEX "scheduled_job_executions_scheduled_job_id_occurrence_key_key" ON "scheduled_job_executions"("scheduled_job_id", "occurrence_key");
CREATE INDEX "scheduled_job_executions_organization_id_status_created_at_idx" ON "scheduled_job_executions"("organization_id", "status", "created_at");
CREATE UNIQUE INDEX "reminder_policies_organization_id_name_key" ON "reminder_policies"("organization_id", "name");
CREATE INDEX "reminder_policies_organization_id_active_idx" ON "reminder_policies"("organization_id", "active");
CREATE UNIQUE INDEX "scheduled_reports_scheduled_job_id_key" ON "scheduled_reports"("scheduled_job_id");
CREATE UNIQUE INDEX "scheduled_reports_organization_id_name_key" ON "scheduled_reports"("organization_id", "name");
CREATE INDEX "scheduled_reports_organization_id_active_idx" ON "scheduled_reports"("organization_id", "active");
CREATE INDEX "notifications_organization_id_recipient_user_id_status_crea_idx" ON "notifications"("organization_id", "recipient_user_id", "status", "created_at");
CREATE UNIQUE INDEX "notification_preferences_organization_id_user_id_event_key_key" ON "notification_preferences"("organization_id", "user_id", "event_key");
CREATE INDEX "notification_preferences_organization_id_user_id_idx" ON "notification_preferences"("organization_id", "user_id");

ALTER TABLE "domain_event_outbox" ADD CONSTRAINT "domain_event_outbox_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_policy_steps" ADD CONSTRAINT "approval_policy_steps_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_request_steps" ADD CONSTRAINT "approval_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "approval_request_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "workflow_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_job_executions" ADD CONSTRAINT "scheduled_job_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_job_executions" ADD CONSTRAINT "scheduled_job_executions_scheduled_job_id_fkey" FOREIGN KEY ("scheduled_job_id") REFERENCES "scheduled_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reminder_policies" ADD CONSTRAINT "reminder_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_saved_report_id_fkey" FOREIGN KEY ("saved_report_id") REFERENCES "saved_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_scheduled_job_id_fkey" FOREIGN KEY ("scheduled_job_id") REFERENCES "scheduled_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the four legacy recurring schedules. Business content stays in its existing template;
-- `scheduled_jobs` becomes the single next-run owner once the scheduler adapters are enabled.
INSERT INTO "scheduled_jobs" ("organization_id", "created_by_user_id", "handler", "source_type", "source_id", "payload", "schedule", "time_zone", "misfire_policy", "status", "next_run_at")
SELECT r."organization_id", r."created_by_user_id", 'recurring.invoice', 'RECURRING_INVOICE_TEMPLATE', r."id", '{}', jsonb_build_object('cadence', r."cadence"::text), o."time_zone", 'CATCH_UP', CASE WHEN r."active" THEN 'ACTIVE'::"ScheduledJobStatus" ELSE 'PAUSED'::"ScheduledJobStatus" END, r."next_run_date"::timestamptz
FROM "recurring_invoice_templates" r JOIN "organizations" o ON o."id" = r."organization_id";
INSERT INTO "scheduled_jobs" ("organization_id", "created_by_user_id", "handler", "source_type", "source_id", "payload", "schedule", "time_zone", "misfire_policy", "status", "next_run_at")
SELECT r."organization_id", r."created_by_user_id", 'recurring.bill', 'RECURRING_BILL_TEMPLATE', r."id", '{}', jsonb_build_object('cadence', r."cadence"::text), o."time_zone", 'CATCH_UP', CASE WHEN r."active" THEN 'ACTIVE'::"ScheduledJobStatus" ELSE 'PAUSED'::"ScheduledJobStatus" END, r."next_run_date"::timestamptz
FROM "recurring_bill_templates" r JOIN "organizations" o ON o."id" = r."organization_id";
INSERT INTO "scheduled_jobs" ("organization_id", "created_by_user_id", "handler", "source_type", "source_id", "payload", "schedule", "time_zone", "misfire_policy", "status", "next_run_at")
SELECT r."organization_id", r."created_by_user_id", 'recurring.expense', 'RECURRING_EXPENSE_TEMPLATE', r."id", '{}', jsonb_build_object('cadence', r."cadence"::text), o."time_zone", 'CATCH_UP', CASE WHEN r."active" THEN 'ACTIVE'::"ScheduledJobStatus" ELSE 'PAUSED'::"ScheduledJobStatus" END, r."next_run_date"::timestamptz
FROM "recurring_expense_templates" r JOIN "organizations" o ON o."id" = r."organization_id";
INSERT INTO "scheduled_jobs" ("organization_id", "created_by_user_id", "handler", "source_type", "source_id", "payload", "schedule", "time_zone", "misfire_policy", "status", "next_run_at")
SELECT r."organization_id", r."created_by_user_id", 'recurring.journal', 'RECURRING_JOURNAL_TEMPLATE', r."id", '{}', jsonb_build_object('cadence', r."cadence"::text), o."time_zone", 'CATCH_UP', CASE WHEN r."active" THEN 'ACTIVE'::"ScheduledJobStatus" ELSE 'PAUSED'::"ScheduledJobStatus" END, r."next_run_date"::timestamptz
FROM "recurring_journal_templates" r JOIN "organizations" o ON o."id" = r."organization_id";
