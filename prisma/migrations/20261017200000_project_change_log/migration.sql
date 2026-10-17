-- The wording "BOM" becomes "BOQ" everywhere. Renames keep all existing data.
ALTER TYPE "ProjectStage" RENAME VALUE 'SIZING_BOM' TO 'SIZING_BOQ';
ALTER TABLE "projects" RENAME COLUMN "bom_status" TO "boq_status";

-- CreateTable
CREATE TABLE "project_changes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_changes_project_id_changed_at_idx" ON "project_changes"("project_id", "changed_at");

-- AddForeignKey
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A change must name its field and actually change the value.
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_field_not_blank_chk"
    CHECK (btrim("field") <> '');
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_value_differs_chk"
    CHECK ("from_value" IS DISTINCT FROM "to_value");

-- project_changes is append-only: reject UPDATE, DELETE and TRUNCATE.
CREATE FUNCTION "project_changes_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'project_changes is append-only (% rejected)', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "project_changes_no_update_delete"
    BEFORE UPDATE OR DELETE ON "project_changes"
    FOR EACH ROW EXECUTE FUNCTION "project_changes_reject_change"();

CREATE TRIGGER "project_changes_no_truncate"
    BEFORE TRUNCATE ON "project_changes"
    FOR EACH STATEMENT EXECUTE FUNCTION "project_changes_reject_change"();
