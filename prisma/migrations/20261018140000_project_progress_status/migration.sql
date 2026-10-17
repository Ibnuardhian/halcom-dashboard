-- CreateEnum
CREATE TYPE "ProjectProgress" AS ENUM ('QUALIFY', 'UNDERSTAND', 'PROPOSE', 'NEGOTIATE', 'NEGOTIATE_FU', 'AGREE', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('ON_TRACK', 'ON_HOLD', 'DONE', 'BLOCK');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "progress" "ProjectProgress" NOT NULL DEFAULT 'QUALIFY',
ADD COLUMN     "quote_released_at" DATE,
ADD COLUMN     "track_status" "TrackStatus" NOT NULL DEFAULT 'ON_TRACK';

-- Starting values for the projects that already exist, from their stage and status (same mapping as
-- progressFromStage / trackStatusFromStatus in src/domain/projects/progress.ts). Sales correct them in the application.
UPDATE "projects" SET "progress" = CASE "stage"
    WHEN 'NEW_OPPORTUNITY' THEN 'QUALIFY'
    WHEN 'ASSESSMENT' THEN 'UNDERSTAND'
    WHEN 'SIZING_BOQ' THEN 'PROPOSE'
    WHEN 'POC' THEN 'PROPOSE'
    WHEN 'QUOTATION' THEN 'PROPOSE'
    WHEN 'NEGOTIATION' THEN 'NEGOTIATE'
    WHEN 'WON' THEN 'CLOSED_WON'
    WHEN 'LOST' THEN 'CLOSED_LOST'
  END::"ProjectProgress";

UPDATE "projects" SET "track_status" = CASE "status"
    WHEN 'ACTIVE' THEN 'ON_TRACK'
    WHEN 'WON' THEN 'ON_TRACK'
    WHEN 'ON_HOLD' THEN 'ON_HOLD'
    ELSE 'DONE'
  END::"TrackStatus";

-- CreateIndex
CREATE INDEX "projects_progress_idx" ON "projects"("progress");
