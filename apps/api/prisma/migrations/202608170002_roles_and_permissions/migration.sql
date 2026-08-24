CREATE TABLE "organization_role_permissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "role" "OrganizationRole" NOT NULL,
  "permission_key" VARCHAR(60) NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_role_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_role_permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_role_permissions_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_role_permissions_org_role_key_key" ON "organization_role_permissions"("organization_id", "role", "permission_key");
CREATE INDEX "organization_role_permissions_organization_id_role_idx" ON "organization_role_permissions"("organization_id", "role");
