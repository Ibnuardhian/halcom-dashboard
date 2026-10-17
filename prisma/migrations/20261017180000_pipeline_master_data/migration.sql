-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('NEW_OPPORTUNITY', 'ASSESSMENT', 'SIZING_BOM', 'POC', 'QUOTATION', 'NEGOTIATION', 'WON', 'LOST');
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "ProjectStatus" ADD VALUE 'WON';
ALTER TYPE "ProjectStatus" ADD VALUE 'LOST';
ALTER TYPE "ProjectStatus" ADD VALUE 'COMPLETED';
-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "architecture_status" TEXT,
ADD COLUMN     "assessment_status" TEXT,
ADD COLUMN     "bom_status" TEXT,
ADD COLUMN     "competition_status" TEXT,
ADD COLUMN     "competitor" TEXT,
ADD COLUMN     "current_action" TEXT,
ADD COLUMN     "custom_fields" JSONB,
ADD COLUMN     "customer_id" UUID,
ADD COLUMN     "estimated_value" DECIMAL(18,2),
ADD COLUMN     "final_value" DECIMAL(18,2),
ADD COLUMN     "imported_from" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "lost_notes" TEXT,
ADD COLUMN     "lost_reason" TEXT,
ADD COLUMN     "next_action" TEXT,
ADD COLUMN     "poc_status" TEXT,
ADD COLUMN     "principal_id" UUID,
ADD COLUMN     "probability" INTEGER,
ADD COLUMN     "proposal_status" TEXT,
ADD COLUMN     "quotation_status" TEXT,
ADD COLUMN     "requirement" TEXT,
ADD COLUMN     "scope_estimate" TEXT,
ADD COLUMN     "sizing_status" TEXT,
ADD COLUMN     "solution_category_id" UUID,
ADD COLUMN     "solution_proposed" TEXT,
ADD COLUMN     "stage" "ProjectStage" NOT NULL DEFAULT 'NEW_OPPORTUNITY',
ADD COLUMN     "stakeholders" TEXT,
ADD COLUMN     "technical_blocker" TEXT,
ADD COLUMN     "technical_challenge" TEXT,
ADD COLUMN     "technical_notes" TEXT,
ADD COLUMN     "technical_pic_id" UUID,
ADD COLUMN     "won_date" DATE;
-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "principals" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "principals_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "solution_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "solution_categories_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "customers_name_key_key" ON "customers"("name_key");
-- CreateIndex
CREATE UNIQUE INDEX "principals_name_key_key" ON "principals"("name_key");
-- CreateIndex
CREATE UNIQUE INDEX "solution_categories_name_key_key" ON "solution_categories"("name_key");
-- CreateIndex
CREATE INDEX "projects_stage_idx" ON "projects"("stage");
-- CreateIndex
CREATE INDEX "projects_technical_pic_id_idx" ON "projects"("technical_pic_id");
-- CreateIndex
CREATE INDEX "projects_customer_id_idx" ON "projects"("customer_id");
-- CreateIndex
CREATE INDEX "projects_principal_id_idx" ON "projects"("principal_id");
-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_technical_pic_id_fkey" FOREIGN KEY ("technical_pic_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_solution_category_id_fkey" FOREIGN KEY ("solution_category_id") REFERENCES "solution_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules enforced by the database.
ALTER TABLE "projects" ADD CONSTRAINT "projects_probability_range_chk"
    CHECK ("probability" IS NULL OR ("probability" BETWEEN 0 AND 100));
ALTER TABLE "projects" ADD CONSTRAINT "projects_values_not_negative_chk"
    CHECK (("estimated_value" IS NULL OR "estimated_value" >= 0) AND ("final_value" IS NULL OR "final_value" >= 0));

-- Project codes follow the sales export (PRJ-001, PRJ-002...). The rule is loosened from the earlier
-- PRJ-YYNNNN shape; any project created under that shape still satisfies the new one.
ALTER TABLE "projects" DROP CONSTRAINT "projects_code_format_chk";
ALTER TABLE "projects" ADD CONSTRAINT "projects_code_format_chk"
    CHECK ("code" ~ '^PRJ-[0-9]{3,}$');

-- Master-data keys are stored normalised (trimmed, single-spaced, lower-case), so "HPE" and " hpe " cannot both exist.
ALTER TABLE "customers" ADD CONSTRAINT "customers_name_key_normalised_chk"
    CHECK ("name_key" <> '' AND "name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')));
ALTER TABLE "principals" ADD CONSTRAINT "principals_name_key_normalised_chk"
    CHECK ("name_key" <> '' AND "name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')));
ALTER TABLE "solution_categories" ADD CONSTRAINT "solution_categories_name_key_normalised_chk"
    CHECK ("name_key" <> '' AND "name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')));
