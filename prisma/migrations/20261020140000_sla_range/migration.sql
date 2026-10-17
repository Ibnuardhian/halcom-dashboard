-- The SLA is a range of days ("2-3", "1-4", at most 7), not a single number of days (1 to 3) with a configurable working week.
-- The working-week columns of the previous migration only ever held their defaults, so they are dropped again.
ALTER TABLE "team_settings" DROP CONSTRAINT "team_settings_work_week_chk";
ALTER TABLE "team_settings" DROP COLUMN "work_start_day";
ALTER TABLE "team_settings" DROP COLUMN "work_end_day";

-- "sla_days" stays and becomes the deadline (the last number of the range); "sla_min_days" is when an answer is expected.
ALTER TABLE "team_settings" ADD COLUMN "sla_min_days" INTEGER;
UPDATE "team_settings" SET "sla_min_days" = "sla_days";
ALTER TABLE "team_settings" ALTER COLUMN "sla_min_days" SET NOT NULL;
ALTER TABLE "team_settings" DROP CONSTRAINT "team_settings_sla_days_chk";
ALTER TABLE "team_settings" ADD CONSTRAINT "team_settings_sla_range_chk" CHECK ("sla_min_days" >= 1 AND "sla_days" <= 7 AND "sla_min_days" <= "sla_days");
