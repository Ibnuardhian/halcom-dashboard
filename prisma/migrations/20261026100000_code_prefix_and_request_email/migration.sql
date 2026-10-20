-- Additive only: nothing is dropped, renamed or rewritten.
--
-- 1. users.code_prefix: the prefix of a person's request codes (RFQ-S-260001). One letter from the e-mail address; a person whose letter is
--    taken gets the first two letters, and so on. Assigned the first time the person raises a request and kept, so a code never changes.
--    Existing requests keep the codes they already have; only new requests use the prefix.
ALTER TABLE "users" ADD COLUMN "code_prefix" TEXT;
CREATE UNIQUE INDEX "users_code_prefix_key" ON "users"("code_prefix");
ALTER TABLE "users" ADD CONSTRAINT "users_code_prefix_chk" CHECK ("code_prefix" IS NULL OR "code_prefix" ~ '^[A-Z]+[0-9]*$');

-- 2. The e-mail a request came from and when the team first answered it, as in the RFQ tracker: the link to the mail, its Message-ID and
--    Conversation-ID (to find the thread again), the time of the first response, and the file an imported request came from.
ALTER TABLE "requests" ADD COLUMN "email_link" TEXT;
ALTER TABLE "requests" ADD COLUMN "email_message_id" TEXT;
ALTER TABLE "requests" ADD COLUMN "email_conversation_id" TEXT;
ALTER TABLE "requests" ADD COLUMN "responded_at" TIMESTAMPTZ(3);
ALTER TABLE "requests" ADD COLUMN "imported_from" TEXT;
-- A request cannot be answered before it was raised.
ALTER TABLE "requests" ADD CONSTRAINT "requests_responded_after_created_chk" CHECK ("responded_at" IS NULL OR "responded_at" >= "created_at");

-- 3. Indexes for lookups that had none: foreign keys used to filter or to check a delete. They only speed up reads and cost a little on
--    writes; they change no data.
CREATE INDEX "requests_requester_id_idx" ON "requests"("requester_id");
CREATE INDEX "projects_solution_category_id_idx" ON "projects"("solution_category_id");
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");
