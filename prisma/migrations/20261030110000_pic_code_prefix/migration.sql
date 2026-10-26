-- A PIC can be the named requester of a request (raised through the shared SOA login), so it carries a code prefix like a user does.
ALTER TABLE "pics" ADD COLUMN "code_prefix" TEXT;
CREATE UNIQUE INDEX "pics_code_prefix_key" ON "pics"("code_prefix");
