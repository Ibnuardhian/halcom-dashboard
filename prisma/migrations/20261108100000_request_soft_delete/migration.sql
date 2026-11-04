-- A superadmin can delete a BOQ, RFQ or PO request. Its status history is append-only, so the row stays and is hidden instead.
ALTER TABLE "requests" ADD COLUMN "deleted_at" TIMESTAMPTZ(3), ADD COLUMN "deleted_by_id" UUID;
ALTER TABLE "requests" ADD CONSTRAINT "requests_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
