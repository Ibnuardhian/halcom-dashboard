-- CreateEnum
CREATE TYPE "SoaPhase" AS ENUM ('ASSESSMENT', 'SIZING', 'POC');

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "phase" "SoaPhase";

-- Only a BOQ request carries an SOA phase.
ALTER TABLE "requests" ADD CONSTRAINT "requests_phase_boq_only_chk"
  CHECK ("phase" IS NULL OR "type" = 'BOQ');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
