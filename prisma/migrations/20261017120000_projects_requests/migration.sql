-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('BOQ', 'RFQ', 'PO');
-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUBMITTED', 'IN_PROGRESS', 'WAITING_FOR_SALES', 'COMPLETED', 'CANCELLED');
-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'CLOSED');
-- CreateTable
CREATE TABLE "code_counters" (
    "scope" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL,
    CONSTRAINT "code_counters_pkey" PRIMARY KEY ("scope")
);
-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "end_user_company" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "target_date" DATE,
    "sales_owner_id" UUID NOT NULL,
    "submission_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "RequestType" NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "required_by" DATE,
    "requester_id" UUID NOT NULL,
    "assignee_id" UUID,
    "source_request_id" UUID,
    "submission_key" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "request_status_history" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "from_status" "RequestStatus",
    "to_status" "RequestStatus" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    CONSTRAINT "request_status_history_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");
-- CreateIndex
CREATE UNIQUE INDEX "projects_submission_key_key" ON "projects"("submission_key");
-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");
-- CreateIndex
CREATE INDEX "projects_sales_owner_id_idx" ON "projects"("sales_owner_id");
-- CreateIndex
CREATE UNIQUE INDEX "requests_code_key" ON "requests"("code");
-- CreateIndex
CREATE UNIQUE INDEX "requests_submission_key_key" ON "requests"("submission_key");
-- CreateIndex
CREATE INDEX "requests_project_id_idx" ON "requests"("project_id");
-- CreateIndex
CREATE INDEX "requests_type_status_idx" ON "requests"("type", "status");
-- CreateIndex
CREATE INDEX "requests_status_idx" ON "requests"("status");
-- CreateIndex
CREATE INDEX "requests_created_at_idx" ON "requests"("created_at");
-- CreateIndex
CREATE UNIQUE INDEX "requests_source_request_id_type_key" ON "requests"("source_request_id", "type");
-- CreateIndex
CREATE INDEX "request_status_history_request_id_changed_at_idx" ON "request_status_history"("request_id", "changed_at");
-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_sales_owner_id_fkey" FOREIGN KEY ("sales_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_source_request_id_fkey" FOREIGN KEY ("source_request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules enforced by the database, not only by the application.
ALTER TABLE "code_counters" ADD CONSTRAINT "code_counters_positive_chk"
    CHECK ("last_value" >= 1);

ALTER TABLE "projects" ADD CONSTRAINT "projects_code_format_chk"
    CHECK ("code" ~ '^PRJ-[0-9]{2}[0-9]{4,}$');
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_name_not_blank_chk"
    CHECK (btrim("end_user_company") <> '' AND btrim("name") <> '');

-- BOQ-IA-260001 / RFQ-IA-260001 / PO-IA-260001: the prefix must match the request type.
ALTER TABLE "requests" ADD CONSTRAINT "requests_code_format_chk"
    CHECK ("code" ~ '^(BOQ|RFQ|PO)-[A-Z0-9]{1,3}-[0-9]{2}[0-9]{4,}$'
           AND split_part("code", '-', 1) = "type"::text);
ALTER TABLE "requests" ADD CONSTRAINT "requests_title_not_blank_chk"
    CHECK (btrim("title") <> '');
-- completed_at is set exactly while the request is Completed; reopening clears it and the
-- earlier completion stays in request_status_history.
ALTER TABLE "requests" ADD CONSTRAINT "requests_completed_at_matches_status_chk"
    CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));
-- Only an RFQ or PO can come from a handover, and never from itself.
ALTER TABLE "requests" ADD CONSTRAINT "requests_source_only_for_purchasing_chk"
    CHECK ("source_request_id" IS NULL OR ("type" IN ('RFQ', 'PO') AND "source_request_id" <> "id"));

ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_changes_status_chk"
    CHECK ("from_status" IS DISTINCT FROM "to_status");

-- request_status_history is append-only (brief §6.3): reject UPDATE, DELETE and TRUNCATE.
CREATE FUNCTION "request_status_history_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'request_status_history is append-only (% rejected)', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "request_status_history_no_update_delete"
    BEFORE UPDATE OR DELETE ON "request_status_history"
    FOR EACH ROW EXECUTE FUNCTION "request_status_history_reject_change"();

CREATE TRIGGER "request_status_history_no_truncate"
    BEFORE TRUNCATE ON "request_status_history"
    FOR EACH STATEMENT EXECUTE FUNCTION "request_status_history_reject_change"();
