-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "is_control" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "system_key" VARCHAR(40);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_organization_id_system_key_key" ON "ledger_accounts"("organization_id", "system_key");

