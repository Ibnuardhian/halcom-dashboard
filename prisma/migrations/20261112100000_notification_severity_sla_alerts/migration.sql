-- Three levels for notifications (info, warning, danger) and the link from an alert to the request it is about.
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'DANGER');

ALTER TABLE "notifications" ADD COLUMN "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO';
-- The request an SLA alert is about (no foreign key: an alert may outlive a cleaned-up request), so it can be closed when the request is finished.
ALTER TABLE "notifications" ADD COLUMN "request_id" UUID;
-- One alert per recipient, request, SLA round and level: a repeated scan finds the row and writes nothing.
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" TEXT;

-- Revision notifications were already shown in red.
UPDATE "notifications" SET "severity" = 'DANGER' WHERE "kind" IN ('request.revision_requested', 'request.revision_started');

CREATE UNIQUE INDEX "notifications_recipient_id_dedupe_key_key" ON "notifications"("recipient_id", "dedupe_key");
CREATE INDEX "notifications_request_id_idx" ON "notifications"("request_id");
CREATE INDEX "notifications_recipient_id_severity_read_at_idx" ON "notifications"("recipient_id", "severity", "read_at");
