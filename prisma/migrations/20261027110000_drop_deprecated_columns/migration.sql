-- Requested by the product owner (D-036): take out the columns that earlier migrations marked deprecated. DESTRUCTIVE: back up first.
-- Nothing in the application reads or writes them any more:
--   projects.stage   was replaced by projects.progress   (migration 20261018140000; the export's values were mapped into it)
--   projects.status  was replaced by projects.track_status
--   requests.assignee_id was replaced by requests.pic_id (migration 20261023110000; the operational assignee is a PIC, not a login)
-- Their indexes, the foreign key of assignee_id and the two enum types go with them.
ALTER TABLE "projects" DROP COLUMN "stage";
ALTER TABLE "projects" DROP COLUMN "status";
ALTER TABLE "requests" DROP COLUMN "assignee_id";
DROP TYPE "ProjectStage";
DROP TYPE "ProjectStatus";
