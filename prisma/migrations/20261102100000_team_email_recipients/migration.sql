-- Who the team's request e-mail goes to (To) and who is copied (Cc), edited in the SLA module. Empty means the server's
-- EMAIL_TO_HIT* / EMAIL_CC_HIT* settings still apply, so nothing existing changes.
ALTER TABLE "team_settings" ADD COLUMN "email_to" TEXT NOT NULL DEFAULT '';
ALTER TABLE "team_settings" ADD COLUMN "email_cc" TEXT NOT NULL DEFAULT '';
