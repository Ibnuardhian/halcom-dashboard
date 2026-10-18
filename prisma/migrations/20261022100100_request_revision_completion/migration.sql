-- A BOQ in Revision keeps the time of its first completion (the revision does not restart or fail the SLA), so completed_at is now set
-- exactly while the request is Completed or in Revision. The check only becomes looser: every existing row still satisfies it and no
-- data is touched. (A separate migration from the new enum value, which PostgreSQL does not allow to be used in the same transaction.)
ALTER TABLE "requests" DROP CONSTRAINT "requests_completed_at_matches_status_chk";
ALTER TABLE "requests" ADD CONSTRAINT "requests_completed_at_matches_status_chk"
    CHECK (("status" IN ('COMPLETED', 'REVISION')) = ("completed_at" IS NOT NULL));
