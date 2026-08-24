-- DropForeignKey
ALTER TABLE "organization_role_permissions" DROP CONSTRAINT "organization_role_permissions_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "organization_role_permissions" DROP CONSTRAINT "organization_role_permissions_updated_by_user_id_fkey";

-- DropIndex
DROP INDEX "organization_members_organization_id_role_idx";

-- AlterTable
ALTER TABLE "organization_invitations" DROP COLUMN "role",
ADD COLUMN     "role_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "organization_members" DROP COLUMN "role",
ADD COLUMN     "role_id" UUID NOT NULL;

-- DropTable
DROP TABLE "organization_role_permissions";

-- DropEnum
DROP TYPE "OrganizationRole";

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_owner_role" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_key" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateIndex
CREATE INDEX "roles_organization_id_is_system_idx" ON "roles"("organization_id", "is_system");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_role_id_idx" ON "organization_members"("organization_id", "role_id");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

