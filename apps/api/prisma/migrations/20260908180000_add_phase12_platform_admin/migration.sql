-- Phase 12: Platform Admin.
--
-- Everything here is platform-scoped rather than tenant-scoped. `platform_admins` is the boundary
-- itself: Phase 8 shipped a `PLATFORM_ADMIN_EMAILS` environment allowlist as an explicit
-- placeholder, and this table replaces it. The allowlist survives in code only as a bootstrap path
-- for a deployment that has no grants yet.

-- Enums -----------------------------------------------------------------------------------------

CREATE TYPE "PlatformRole" AS ENUM ('SUPPORT', 'OPERATIONS', 'SUPERADMIN');
CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');
CREATE TYPE "FeatureFlagStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "FeatureFlagScope" AS ENUM ('GLOBAL', 'COUNTRY', 'PLAN', 'ORGANIZATION');

-- Organization suspension metadata ---------------------------------------------------------------
-- Suspension blocks access and changes nothing else, so these three columns are the whole record of
-- it. `OrganizationStatus.SUSPENDED` already exists; what was missing was who, when and why.

ALTER TABLE "organizations"
  ADD COLUMN "suspended_at" TIMESTAMPTZ(6),
  ADD COLUMN "suspended_reason" VARCHAR(500),
  ADD COLUMN "suspended_by_user_id" UUID;

-- Any organization already sitting in SUSPENDED predates this metadata. Stamping it with the
-- migration's own timestamp would invent a suspension date that never happened, so the columns stay
-- null and the console reads "recorded before platform administration existed".

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_suspended_by_user_id_fkey"
  FOREIGN KEY ("suspended_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Platform boundary -------------------------------------------------------------------------------

CREATE TABLE "platform_admins" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "role" "PlatformRole" NOT NULL DEFAULT 'SUPPORT',
  "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
  "granted_by_user_id" UUID,
  "note" VARCHAR(500),
  "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admins_user_id_key" ON "platform_admins"("user_id");
CREATE INDEX "platform_admins_status_role_idx" ON "platform_admins"("status", "role");

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "platform_admins_granted_by_user_id_fkey"
  FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "platform_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "platform_admin_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "event_key" VARCHAR(100) NOT NULL,
  "target_type" VARCHAR(60) NOT NULL,
  "target_id" VARCHAR(100),
  "organization_id" UUID,
  "reason" VARCHAR(500),
  "before_json" JSONB,
  "after_json" JSONB,
  "ip_hash" CHAR(64),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_events_occurred_at_idx" ON "platform_audit_events"("occurred_at");
CREATE INDEX "platform_audit_events_organization_id_occurred_at_idx"
  ON "platform_audit_events"("organization_id", "occurred_at");
CREATE INDEX "platform_audit_events_event_key_occurred_at_idx"
  ON "platform_audit_events"("event_key", "occurred_at");

ALTER TABLE "platform_audit_events"
  ADD CONSTRAINT "platform_audit_events_platform_admin_id_fkey"
  FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "platform_audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "platform_audit_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Plans and entitlements ---------------------------------------------------------------------------

CREATE TABLE "plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "trial_days" SMALLINT NOT NULL DEFAULT 0,
  "price_minor" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "billing_interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
  "sort_order" SMALLINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");
CREATE INDEX "plans_status_sort_order_idx" ON "plans"("status", "sort_order");

-- At most one default plan, enforced by the database rather than by the service remembering to
-- clear the previous one. A partial unique index is the right shape: it constrains only the rows
-- that claim the default.
CREATE UNIQUE INDEX "plans_single_default" ON "plans"(("is_default")) WHERE "is_default";

CREATE TABLE "plan_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "key" VARCHAR(60) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "limit_value" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_entitlements_plan_id_key_key" ON "plan_entitlements"("plan_id", "key");

ALTER TABLE "plan_entitlements"
  ADD CONSTRAINT "plan_entitlements_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A negative limit is meaningless; "no limit" is NULL, and "none allowed" is 0.
ALTER TABLE "plan_entitlements"
  ADD CONSTRAINT "plan_entitlements_limit_non_negative"
  CHECK ("limit_value" IS NULL OR "limit_value" >= 0);

CREATE TABLE "organization_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "trial_ends_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_subscriptions_organization_id_key"
  ON "organization_subscriptions"("organization_id");
CREATE INDEX "organization_subscriptions_plan_id_status_idx"
  ON "organization_subscriptions"("plan_id", "status");

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "organization_subscriptions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Feature flags ------------------------------------------------------------------------------------

CREATE TABLE "feature_flags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(60) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "default_enabled" BOOLEAN NOT NULL DEFAULT false,
  "status" "FeatureFlagStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");
CREATE INDEX "feature_flags_status_idx" ON "feature_flags"("status");

CREATE TABLE "feature_flag_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "flag_id" UUID NOT NULL,
  "scope" "FeatureFlagScope" NOT NULL,
  "country_code" CHAR(2),
  "plan_id" UUID,
  "organization_id" UUID,
  "enabled" BOOLEAN NOT NULL,
  "note" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feature_flag_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feature_flag_rules_flag_id_scope_idx" ON "feature_flag_rules"("flag_id", "scope");
CREATE INDEX "feature_flag_rules_organization_id_idx" ON "feature_flag_rules"("organization_id");

ALTER TABLE "feature_flag_rules"
  ADD CONSTRAINT "feature_flag_rules_flag_id_fkey"
  FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "feature_flag_rules_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "feature_flag_rules_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The scope column and the target columns must agree. Without this a rule could claim PLAN scope
-- while naming an organization, and the resolver would silently never match it.
ALTER TABLE "feature_flag_rules"
  ADD CONSTRAINT "feature_flag_rules_scope_target"
  CHECK (
    ("scope" = 'GLOBAL'
      AND "country_code" IS NULL AND "plan_id" IS NULL AND "organization_id" IS NULL)
    OR ("scope" = 'COUNTRY'
      AND "country_code" IS NOT NULL AND "plan_id" IS NULL AND "organization_id" IS NULL)
    OR ("scope" = 'PLAN'
      AND "country_code" IS NULL AND "plan_id" IS NOT NULL AND "organization_id" IS NULL)
    OR ("scope" = 'ORGANIZATION'
      AND "country_code" IS NULL AND "plan_id" IS NULL AND "organization_id" IS NOT NULL)
  );

-- One rule per flag per target: a flag cannot be both on and off for the same organization.
CREATE UNIQUE INDEX "feature_flag_rules_global" ON "feature_flag_rules"("flag_id")
  WHERE "scope" = 'GLOBAL';
CREATE UNIQUE INDEX "feature_flag_rules_country" ON "feature_flag_rules"("flag_id", "country_code")
  WHERE "scope" = 'COUNTRY';
CREATE UNIQUE INDEX "feature_flag_rules_plan" ON "feature_flag_rules"("flag_id", "plan_id")
  WHERE "scope" = 'PLAN';
CREATE UNIQUE INDEX "feature_flag_rules_organization"
  ON "feature_flag_rules"("flag_id", "organization_id")
  WHERE "scope" = 'ORGANIZATION';

-- Seed: a starter plan set -------------------------------------------------------------------------
-- Every organization needs a plan for entitlement resolution to mean anything, and a deployment
-- upgrading into Phase 12 has none. Free is the default so existing tenants land somewhere sane;
-- the limits below are starting points a superadmin edits in the console, not product decisions
-- baked into a migration.

INSERT INTO "plans" ("key", "name", "description", "status", "is_default", "trial_days", "sort_order")
VALUES
  ('free', 'Free', 'Single-user books with core accounting.', 'ACTIVE', true, 0, 10),
  ('growth', 'Growth', 'Multi-user books with automation and portals.', 'ACTIVE', false, 14, 20),
  ('scale', 'Scale', 'Unlimited users, projects, and inventory.', 'ACTIVE', false, 14, 30)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "plan_entitlements" ("plan_id", "key", "enabled", "limit_value")
SELECT plans.id, grants.key, grants.enabled, grants.limit_value
FROM "plans"
CROSS JOIN LATERAL (
  VALUES
    ('free', 'members.max', true, 2),
    ('free', 'organizations.max', true, 1),
    ('free', 'portal.enabled', false, NULL),
    ('free', 'automation.enabled', false, NULL),
    ('free', 'inventory.enabled', false, NULL),
    ('free', 'projects.enabled', false, NULL),
    ('growth', 'members.max', true, 10),
    ('growth', 'organizations.max', true, 3),
    ('growth', 'portal.enabled', true, NULL),
    ('growth', 'automation.enabled', true, NULL),
    ('growth', 'inventory.enabled', true, NULL),
    ('growth', 'projects.enabled', true, NULL),
    ('scale', 'members.max', true, NULL),
    ('scale', 'organizations.max', true, NULL),
    ('scale', 'portal.enabled', true, NULL),
    ('scale', 'automation.enabled', true, NULL),
    ('scale', 'inventory.enabled', true, NULL),
    ('scale', 'projects.enabled', true, NULL)
) AS grants (plan_key, key, enabled, limit_value)
WHERE plans.key = grants.plan_key
ON CONFLICT ("plan_id", "key") DO NOTHING;

-- Backfill: every existing organization onto the default plan, active rather than trialing. They
-- have been running without a subscription, so starting a trial clock now would expire it for
-- tenants that never had one.
INSERT INTO "organization_subscriptions" ("organization_id", "plan_id", "status", "started_at")
SELECT organizations.id, plans.id, 'ACTIVE', organizations.created_at
FROM "organizations"
CROSS JOIN (SELECT id FROM "plans" WHERE "is_default" LIMIT 1) AS plans
ON CONFLICT ("organization_id") DO NOTHING;
