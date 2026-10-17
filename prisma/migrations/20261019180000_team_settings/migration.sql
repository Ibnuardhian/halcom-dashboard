-- Per-team settings the superadmin controls: the SLA in working days and the email template of SOA and Purchasing.
-- A team with no row uses the defaults in the application (src/domain/requests/template.ts).
CREATE TABLE "team_settings" (
    "role" "Role" NOT NULL,
    "sla_days" INTEGER NOT NULL,
    "email_subject" TEXT NOT NULL,
    "email_body" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "team_settings_pkey" PRIMARY KEY ("role")
);

ALTER TABLE "team_settings" ADD CONSTRAINT "team_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_settings" ADD CONSTRAINT "team_settings_role_chk" CHECK ("role" IN ('SOA', 'PURCHASING'));
ALTER TABLE "team_settings" ADD CONSTRAINT "team_settings_sla_days_chk" CHECK ("sla_days" BETWEEN 1 AND 3);
