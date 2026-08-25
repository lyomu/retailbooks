-- CreateEnum
CREATE TYPE "RoundingMode" AS ENUM ('NONE', 'HALF_UP');

-- AlterTable
ALTER TABLE "organization_preferences" ADD COLUMN     "rounding_mode" "RoundingMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "rounding_unit_minor" INTEGER;

