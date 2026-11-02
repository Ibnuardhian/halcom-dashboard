-- Why a Purchasing request was completed after its SLA deadline (asked for when it is moved to Completed while overdue).
ALTER TABLE "requests" ADD COLUMN "overdue_note" TEXT;
