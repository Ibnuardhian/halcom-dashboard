-- A project names its SOA and Purchasing PIC (a row of "pics") besides the shared accounts that receive its notifications.
ALTER TABLE "projects" ADD COLUMN "soa_pic_id" UUID, ADD COLUMN "purchasing_pic_ref_id" UUID;
ALTER TABLE "projects" ADD CONSTRAINT "projects_soa_pic_id_fkey" FOREIGN KEY ("soa_pic_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_purchasing_pic_ref_id_fkey" FOREIGN KEY ("purchasing_pic_ref_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "projects_soa_pic_id_idx" ON "projects"("soa_pic_id");
CREATE INDEX "projects_purchasing_pic_ref_id_idx" ON "projects"("purchasing_pic_ref_id");
