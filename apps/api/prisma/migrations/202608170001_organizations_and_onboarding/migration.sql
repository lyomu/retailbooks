CREATE TYPE "OrganizationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');
CREATE TYPE "OnboardingStep" AS ENUM ('PROFILE', 'JURISDICTION', 'ACCOUNTING', 'TAX', 'NUMBERING', 'TEAM', 'REVIEW', 'COMPLETE');
CREATE TYPE "BusinessType" AS ENUM ('SOLE_PROPRIETOR', 'PARTNERSHIP', 'LIMITED_COMPANY', 'NONPROFIT', 'COOPERATIVE', 'OTHER');
CREATE TYPE "AccountingBasis" AS ENUM ('ACCRUAL', 'CASH');
CREATE TYPE "TaxTreatment" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');
CREATE TYPE "NumberingReset" AS ENUM ('NEVER', 'ANNUAL', 'MONTHLY');

CREATE TABLE "organizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "legal_name" VARCHAR(180) NOT NULL,
  "trading_name" VARCHAR(180),
  "slug" VARCHAR(96) NOT NULL,
  "business_type" "BusinessType" NOT NULL DEFAULT 'OTHER',
  "country_code" CHAR(2) NOT NULL,
  "base_currency" CHAR(3) NOT NULL,
  "time_zone" VARCHAR(64) NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "fiscal_year_start_month" SMALLINT NOT NULL DEFAULT 1,
  "fiscal_year_start_day" SMALLINT NOT NULL DEFAULT 1,
  "status" "OrganizationStatus" NOT NULL DEFAULT 'DRAFT',
  "onboarding_step" "OnboardingStep" NOT NULL DEFAULT 'JURISDICTION',
  "onboarding_completed_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organizations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_created_by_user_id_idx" ON "organizations"("created_by_user_id");
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

CREATE TABLE "organization_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "accounting_basis" "AccountingBasis" NOT NULL DEFAULT 'ACCRUAL',
  "chart_template" VARCHAR(60) NOT NULL DEFAULT 'general-business',
  "books_start_date" DATE,
  "tax_registered" BOOLEAN NOT NULL DEFAULT false,
  "tax_identifier" VARCHAR(60),
  "default_tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'EXCLUSIVE',
  "default_tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "journal_prefix" VARCHAR(12) NOT NULL DEFAULT 'JRN',
  "number_padding" SMALLINT NOT NULL DEFAULT 5,
  "next_journal_number" INTEGER NOT NULL DEFAULT 1,
  "numbering_reset" "NumberingReset" NOT NULL DEFAULT 'ANNUAL',
  "country_pack_code" VARCHAR(8) NOT NULL,
  "country_pack_version" VARCHAR(24) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_preferences_organization_id_key" ON "organization_preferences"("organization_id");

CREATE TABLE "organization_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "OrganizationRole" NOT NULL DEFAULT 'STAFF',
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");
CREATE INDEX "organization_members_user_id_status_idx" ON "organization_members"("user_id", "status");
CREATE INDEX "organization_members_organization_id_role_idx" ON "organization_members"("organization_id", "role");

CREATE TABLE "organization_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "email" CITEXT NOT NULL,
  "role" "OrganizationRole" NOT NULL DEFAULT 'STAFF',
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "token_hash" CHAR(64) NOT NULL,
  "invited_by_user_id" UUID NOT NULL,
  "accepted_by_user_id" UUID,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "notified_at" TIMESTAMPTZ(6),
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");
CREATE INDEX "organization_invitations_organization_id_status_idx" ON "organization_invitations"("organization_id", "status");
CREATE INDEX "organization_invitations_email_status_idx" ON "organization_invitations"("email", "status");
CREATE INDEX "organization_invitations_expires_at_idx" ON "organization_invitations"("expires_at");

ALTER TABLE "security_events" ADD COLUMN "organization_id" UUID;

ALTER TABLE "security_events"
  ADD CONSTRAINT "security_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "security_events_organization_id_occurred_at_idx" ON "security_events"("organization_id", "occurred_at");
