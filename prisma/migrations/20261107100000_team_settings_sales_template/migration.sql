-- The Sales HITPO email template is a third row of team_settings (role SALES); only its template and recipients are used.
ALTER TABLE "team_settings" DROP CONSTRAINT "team_settings_role_chk";
ALTER TABLE "team_settings" ADD CONSTRAINT "team_settings_role_chk" CHECK ("role" IN ('SOA', 'PURCHASING', 'SALES'));
