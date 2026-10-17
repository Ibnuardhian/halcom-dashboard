-- A deleted project is hidden, not removed: its requests, status history, change log and audit trail are append-only.
ALTER TABLE "projects" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
ALTER TABLE "projects" ADD COLUMN "deleted_by_id" UUID;

ALTER TABLE "projects" ADD CONSTRAINT "projects_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "projects_deleted_at_idx" ON "projects"("deleted_at");
