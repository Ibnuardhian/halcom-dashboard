-- AlterTable
ALTER TABLE "projects" ADD COLUMN "target_margin" DECIMAL(5,2);

-- Target margin is a percentage of the sale.
ALTER TABLE "projects" ADD CONSTRAINT "projects_target_margin_range_chk"
  CHECK ("target_margin" IS NULL OR ("target_margin" >= 0 AND "target_margin" <= 100));
