-- Phase 13: AI foundation.
--
-- These records deliberately preserve only attributable metadata and trusted source references.
-- Prompts, model outputs, attachment text, and embeddings are not audit-log fields.

CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED');

CREATE TABLE "ai_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "capability" VARCHAR(80) NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "model" VARCHAR(160) NOT NULL,
  "model_version" VARCHAR(160),
  "status" "AiRunStatus" NOT NULL DEFAULT 'RUNNING',
  "request_hash" CHAR(64) NOT NULL,
  "evidence_hash" CHAR(64) NOT NULL,
  "output_hash" CHAR(64),
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "failure_code" VARCHAR(80),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_runs_organization_id_created_at_idx" ON "ai_runs"("organization_id", "created_at");
CREATE INDEX "ai_runs_organization_id_actor_user_id_created_at_idx"
  ON "ai_runs"("organization_id", "actor_user_id", "created_at");

ALTER TABLE "ai_runs"
  ADD CONSTRAINT "ai_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_runs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "source_type" VARCHAR(60) NOT NULL,
  "source_id" VARCHAR(120) NOT NULL,
  "source_version" CHAR(64) NOT NULL,
  "href" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_evidence_run_id_source_type_source_id_source_version_key"
  ON "ai_evidence"("run_id", "source_type", "source_id", "source_version");
CREATE INDEX "ai_evidence_organization_id_source_type_source_id_idx"
  ON "ai_evidence"("organization_id", "source_type", "source_id");

ALTER TABLE "ai_evidence"
  ADD CONSTRAINT "ai_evidence_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_evidence_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Application authorization is the first boundary. These policies are independent defense in depth
-- for Phase 13 tables, provided by a transaction-local organization id. FORCE matters because table
-- owners normally bypass PostgreSQL RLS. The application service always sets the value before use.
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_runs_organization_isolation" ON "ai_runs"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid);

ALTER TABLE "ai_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_evidence_organization_isolation" ON "ai_evidence"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid);

-- Existing system roles receive the same defaults that new organizations get from roles-catalog.
-- Custom roles are intentionally untouched. ON CONFLICT retains tenant-specific prior decisions.
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT roles.id, grants.permission_key
FROM "roles" AS roles
CROSS JOIN LATERAL (
  VALUES
    ('OWNER', 'ai.assistant.ask'),
    ('OWNER', 'ai.suggestions.view'),
    ('OWNER', 'ai.suggestions.manage'),
    ('OWNER', 'ai.settings.manage'),
    ('ADMIN', 'ai.assistant.ask'),
    ('ADMIN', 'ai.suggestions.view'),
    ('ADMIN', 'ai.suggestions.manage'),
    ('ADMIN', 'ai.settings.manage'),
    ('ACCOUNTANT', 'ai.assistant.ask'),
    ('ACCOUNTANT', 'ai.suggestions.view'),
    ('ACCOUNTANT', 'ai.suggestions.manage'),
    ('VIEWER', 'ai.assistant.ask'),
    ('VIEWER', 'ai.suggestions.view')
) AS grants (role_key, permission_key)
WHERE roles."is_system" = true AND roles."key" = grants.role_key
ON CONFLICT ("role_id", "permission_key") DO NOTHING;
