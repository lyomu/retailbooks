-- Phase 11 is intentionally authored but not applied during the code-first implementation pass.

CREATE TYPE "PortalUserStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "PortalInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "CollaborationVisibility" AS ENUM ('INTERNAL', 'CUSTOMER');
CREATE TYPE "CollaborationTargetType" AS ENUM (
  'QUOTE', 'SALES_ORDER', 'INVOICE', 'CREDIT_NOTE', 'PAYMENT_RECEIVED',
  'PURCHASE_ORDER', 'BILL', 'EXPENSE', 'VENDOR_CREDIT', 'PAYMENT_MADE',
  'JOURNAL', 'OPENING_BALANCE_BATCH', 'BANK_TRANSACTION', 'TRANSFER',
  'RECONCILIATION', 'INVENTORY_ADJUSTMENT', 'STOCK_MOVEMENT', 'PROJECT', 'TIME_ENTRY'
);
CREATE TYPE "ActivityKind" AS ENUM ('STATUS', 'EMAIL', 'APPROVAL', 'ACCOUNTING', 'COMMENT', 'ATTACHMENT', 'USER_ACTION');

ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'QUOTE';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'SALES_ORDER';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'INVOICE';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIVED';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'PURCHASE_ORDER';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'VENDOR_CREDIT';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'PAYMENT_MADE';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'JOURNAL';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE_BATCH';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'BANK_TRANSACTION';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'TRANSFER';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'RECONCILIATION';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'STOCK_MOVEMENT';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'PROJECT';
ALTER TYPE "AttachmentEntityType" ADD VALUE IF NOT EXISTS 'TIME_ENTRY';

ALTER TABLE "sales_orders" ADD COLUMN "portal_visible_at" TIMESTAMPTZ(6);
ALTER TABLE "attachments" ADD COLUMN "visibility" "CollaborationVisibility" NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE "attachments" ADD COLUMN "portal_user_id" UUID;

CREATE TABLE "portal_users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "PortalUserStatus" NOT NULL DEFAULT 'ACTIVE',
  "invited_by_user_id" UUID NOT NULL,
  "activated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "email" CITEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "status" "PortalInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "invited_by_user_id" UUID NOT NULL,
  "accepted_by_user_id" UUID,
  "portal_user_id" UUID,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "target_type" "CollaborationTargetType" NOT NULL,
  "target_id" UUID NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "visibility" "CollaborationVisibility" NOT NULL DEFAULT 'INTERNAL',
  "author_user_id" UUID NOT NULL,
  "portal_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "activities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "target_type" "CollaborationTargetType" NOT NULL,
  "target_id" UUID NOT NULL,
  "kind" "ActivityKind" NOT NULL,
  "visibility" "CollaborationVisibility" NOT NULL DEFAULT 'INTERNAL',
  "event_key" VARCHAR(120) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "actor_user_id" UUID,
  "portal_user_id" UUID,
  "audit_event_id" UUID,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_users_org_contact_user_key" ON "portal_users"("organization_id", "contact_id", "user_id");
CREATE INDEX "portal_users_user_status_idx" ON "portal_users"("user_id", "status");
CREATE INDEX "portal_users_org_contact_status_idx" ON "portal_users"("organization_id", "contact_id", "status");
CREATE UNIQUE INDEX "portal_invitations_token_hash_key" ON "portal_invitations"("token_hash");
CREATE INDEX "portal_invites_org_contact_status_idx" ON "portal_invitations"("organization_id", "contact_id", "status");
CREATE INDEX "portal_invitations_email_status_idx" ON "portal_invitations"("email", "status");
CREATE INDEX "portal_invitations_expires_at_idx" ON "portal_invitations"("expires_at");
CREATE INDEX "comments_org_target_created_idx" ON "comments"("organization_id", "target_type", "target_id", "created_at");
CREATE UNIQUE INDEX "activities_audit_event_id_key" ON "activities"("audit_event_id");
CREATE INDEX "activities_org_target_occurred_idx" ON "activities"("organization_id", "target_type", "target_id", "occurred_at");
CREATE INDEX "sales_orders_org_contact_portal_idx" ON "sales_orders"("organization_id", "contact_id", "portal_visible_at");

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_audit_event_id_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing attachments were internal before Phase 11. Create a first activity projection for their
-- historical upload audit events without mutating append-only audit history.
INSERT INTO "activities" ("organization_id", "target_type", "target_id", "kind", "visibility", "event_key", "metadata", "actor_user_id", "audit_event_id", "occurred_at")
SELECT a."organization_id", upper(a."entity_type"::text)::"CollaborationTargetType", a."entity_id"::uuid,
       'ATTACHMENT', 'INTERNAL', a."event_key", a."metadata_json", a."actor_user_id", a."id", a."occurred_at"
FROM "audit_events" a
WHERE a."event_key" = 'attachments.uploaded'
  AND a."entity_type" IN ('bill', 'expense', 'inventory_adjustment')
  AND a."entity_id" IS NOT NULL;
