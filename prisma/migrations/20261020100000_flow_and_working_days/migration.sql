-- Each team's working week (first and last working day, Monday = 1 ... Sunday = 7), counted by the SLA.
ALTER TABLE "team_settings" ADD COLUMN "work_start_day" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "team_settings" ADD COLUMN "work_end_day" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "team_settings" ADD CONSTRAINT "team_settings_work_week_chk" CHECK ("work_start_day" BETWEEN 1 AND 7 AND "work_end_day" BETWEEN 1 AND 7 AND "work_start_day" <= "work_end_day");

-- Sales' decision not to continue to the next step (BOQ -> RFQ -> PO) after a completed BOQ or RFQ.
ALTER TABLE "requests" ADD COLUMN "flow_stopped_at" TIMESTAMPTZ(3);
ALTER TABLE "requests" ADD COLUMN "flow_stopped_by_id" UUID;
ALTER TABLE "requests" ADD COLUMN "flow_stopped_note" TEXT;
ALTER TABLE "requests" ADD CONSTRAINT "requests_flow_stopped_by_id_fkey" FOREIGN KEY ("flow_stopped_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
