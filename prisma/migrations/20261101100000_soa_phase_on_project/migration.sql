-- The SOA phase belongs to the project, not to one BOQ request. Each project takes the phase of its newest BOQ that had one.
ALTER TABLE "projects" ADD COLUMN "phase" TEXT;

UPDATE "projects" p SET "phase" = r."phase"
FROM (
  SELECT DISTINCT ON ("project_id") "project_id", "phase"
  FROM "requests"
  WHERE "phase" IS NOT NULL
  ORDER BY "project_id", "updated_at" DESC
) r
WHERE r."project_id" = p."id";

ALTER TABLE "projects" ADD CONSTRAINT "projects_phase_fkey" FOREIGN KEY ("phase") REFERENCES "soa_phases"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "requests" DROP CONSTRAINT "requests_phase_boq_only_chk";
ALTER TABLE "requests" DROP CONSTRAINT "requests_phase_fkey";
ALTER TABLE "requests" DROP COLUMN "phase";
