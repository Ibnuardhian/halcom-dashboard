-- A Purchasing PIC next to the Sales and technical (SOA) PICs, and a target margin that can be a fixed amount instead of a percentage.
ALTER TABLE "projects" ADD COLUMN "purchasing_pic_id" UUID;
ALTER TABLE "projects" ADD COLUMN "target_margin_value" DECIMAL(18,2);

ALTER TABLE "projects" ADD CONSTRAINT "projects_purchasing_pic_id_fkey" FOREIGN KEY ("purchasing_pic_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_target_margin_value_chk" CHECK ("target_margin_value" IS NULL OR "target_margin_value" >= 0);
CREATE INDEX "projects_purchasing_pic_id_idx" ON "projects"("purchasing_pic_id");
