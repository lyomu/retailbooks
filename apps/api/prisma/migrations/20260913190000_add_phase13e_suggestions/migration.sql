-- Phase 13E: generic, typed AI suggestions (categorization, variance/anomaly insights, draft text)
-- and correction/dismissal feedback. Payloads carry only small structured values -- never raw
-- prompts, OCR text, or secrets -- matching AiRun's own metadata-only discipline. Accepting a
-- suggestion never mutates a financial record by itself.

CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED', 'EXPIRED');
CREATE TYPE "AiFeedbackKind" AS ENUM ('DISMISSED', 'CORRECTED');

CREATE TABLE "ai_suggestions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "run_id" UUID,
  "capability" VARCHAR(80) NOT NULL,
  "entity_type" VARCHAR(60),
  "entity_id" UUID,
  "payload" JSONB NOT NULL,
  "reason" VARCHAR(400),
  "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(6),
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_suggestions_organization_id_capability_status_idx"
  ON "ai_suggestions"("organization_id", "capability", "status");
CREATE INDEX "ai_suggestions_organization_id_entity_type_entity_id_idx"
  ON "ai_suggestions"("organization_id", "entity_type", "entity_id");

ALTER TABLE "ai_suggestions"
  ADD CONSTRAINT "ai_suggestions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_suggestions_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ai_feedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "suggestion_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "kind" "AiFeedbackKind" NOT NULL,
  "note" VARCHAR(400),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_feedback_organization_id_suggestion_id_idx"
  ON "ai_feedback"("organization_id", "suggestion_id");

ALTER TABLE "ai_feedback"
  ADD CONSTRAINT "ai_feedback_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_feedback_suggestion_id_fkey"
  FOREIGN KEY ("suggestion_id") REFERENCES "ai_suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_feedback_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same tenant-isolation RLS pattern as ai_runs/ai_evidence (20260913120000): FORCE matters because
-- table owners normally bypass RLS. The application service sets app.organization_id transaction-
-- locally before use, same as AiStore.inOrganization already does for ai_runs/ai_evidence.
ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_suggestions_organization_isolation" ON "ai_suggestions"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid);

ALTER TABLE "ai_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_feedback_organization_isolation" ON "ai_feedback"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), '')::uuid);
