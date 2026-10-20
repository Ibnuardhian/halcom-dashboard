-- Where a project came from: the company's own Sales team, or another source (an external sales company) that SOA registers.
-- Additive: every existing project becomes INTERNAL_SALES, because each of them has a Sales owner and no external source was ever
-- recorded. Nothing is inferred and no row is rewritten beyond that default.
CREATE TYPE "ProjectSourceType" AS ENUM ('INTERNAL_SALES', 'OTHER');

ALTER TABLE "projects" ADD COLUMN "source_type" "ProjectSourceType" NOT NULL DEFAULT 'INTERNAL_SALES';
ALTER TABLE "projects" ADD COLUMN "external_source_name" TEXT;
ALTER TABLE "projects" ADD COLUMN "external_contact" TEXT;
ALTER TABLE "projects" ADD COLUMN "external_reference" TEXT;
ALTER TABLE "projects" ADD COLUMN "source_notes" TEXT;

-- An OTHER project has no internal Sales PIC.
ALTER TABLE "projects" ALTER COLUMN "sales_owner_id" DROP NOT NULL;

-- Valid combinations only, whatever code writes the row:
--   INTERNAL_SALES: a Sales PIC, and no external details;
--   OTHER: no Sales PIC, and the name of the external source.
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_chk" CHECK (
  (
    "source_type" = 'INTERNAL_SALES'
    AND "sales_owner_id" IS NOT NULL
    AND "external_source_name" IS NULL
    AND "external_contact" IS NULL
    AND "external_reference" IS NULL
    AND "source_notes" IS NULL
  )
  OR (
    "source_type" = 'OTHER'
    AND "sales_owner_id" IS NULL
    AND "external_source_name" IS NOT NULL
    AND btrim("external_source_name") <> ''
  )
);

CREATE INDEX "projects_source_type_idx" ON "projects"("source_type");
