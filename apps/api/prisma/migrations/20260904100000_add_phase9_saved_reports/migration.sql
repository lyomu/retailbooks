-- Phase 9: saved report definitions. Executable report definitions remain in code; only a user's
-- validated filter configuration is persisted here.
CREATE TABLE "saved_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "report_key" VARCHAR(80) NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_reports_organization_id_created_by_user_id_name_key"
    ON "saved_reports"("organization_id", "created_by_user_id", "name");
CREATE INDEX "saved_reports_organization_id_report_key_idx"
    ON "saved_reports"("organization_id", "report_key");
CREATE INDEX "saved_reports_organization_id_created_by_user_id_updated_at_idx"
    ON "saved_reports"("organization_id", "created_by_user_id", "updated_at");

ALTER TABLE "saved_reports"
    ADD CONSTRAINT "saved_reports_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_reports"
    ADD CONSTRAINT "saved_reports_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
