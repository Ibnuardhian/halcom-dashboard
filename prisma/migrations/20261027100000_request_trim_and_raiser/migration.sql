-- Requested by the product owner (D-036). DESTRUCTIVE for four columns that D-035 added a day earlier; take a backup first.
--
-- The mail link and ids are not kept. "Responded at" is not a column either: the first answer is the status history row that moved the
-- request to In progress (the importer writes that row from the sheet's response date).
ALTER TABLE "requests" DROP CONSTRAINT "requests_responded_after_created_chk";
ALTER TABLE "requests" DROP COLUMN "email_link";
ALTER TABLE "requests" DROP COLUMN "email_message_id";
ALTER TABLE "requests" DROP COLUMN "email_conversation_id";
ALTER TABLE "requests" DROP COLUMN "responded_at";

-- The SOA PIC who raised a request. SOA signs in with one shared account, so when SOA raises a BOQ or RFQ the person is a PIC of team SOA.
ALTER TABLE "requests" ADD COLUMN "raised_by_pic_id" UUID;
ALTER TABLE "requests" ADD CONSTRAINT "requests_raised_by_pic_id_fkey" FOREIGN KEY ("raised_by_pic_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "requests_raised_by_pic_id_idx" ON "requests"("raised_by_pic_id");
