-- Stage history for Pipeline Growth: every change of projects.progress (and the first value of a new project) is written to an append-only table.
-- A trigger writes it, so every way a project is created or changed is covered, SQL imports included, in the same transaction as the change.
-- Additive: nothing is changed or dropped.

CREATE TABLE "project_progress_history" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "project_id" UUID NOT NULL,
    "from_progress" "ProjectProgress",
    "to_progress" "ProjectProgress" NOT NULL,
    "changed_by_id" UUID,
    -- 'baseline': the stage the project had when this table was created (its history before that moment is not known);
    -- 'insert': the project was created; 'update': Sales (or SOA) moved it.
    "source" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_progress_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_progress_history_source_chk" CHECK ("source" IN ('baseline', 'insert', 'update')),
    CONSTRAINT "project_progress_history_changes_chk" CHECK ("from_progress" IS DISTINCT FROM "to_progress")
);

-- The lookup of Pipeline Growth: the latest row of a project at or before a moment.
CREATE INDEX "project_progress_history_project_id_changed_at_idx" ON "project_progress_history"("project_id", "changed_at" DESC);

ALTER TABLE "project_progress_history" ADD CONSTRAINT "project_progress_history_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_progress_history" ADD CONSTRAINT "project_progress_history_changed_by_id_fkey"
    FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only, like the other history tables.
CREATE FUNCTION "project_progress_history_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'project_progress_history is append-only (% rejected)', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "project_progress_history_no_update_delete"
    BEFORE UPDATE OR DELETE ON "project_progress_history"
    FOR EACH ROW EXECUTE FUNCTION "project_progress_history_reject_change"();

CREATE TRIGGER "project_progress_history_no_truncate"
    BEFORE TRUNCATE ON "project_progress_history"
    FOR EACH STATEMENT EXECUTE FUNCTION "project_progress_history_reject_change"();

-- Writes the history row. The time is the moment the database learned of the change (never a backdated one). The person is taken from the
-- transaction setting `app.actor_id` when the application sets it (set_config(..., true)), otherwise it stays empty.
CREATE FUNCTION "project_progress_record"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    actor UUID;
BEGIN
    BEGIN
        actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
        actor := NULL;
    END;
    IF actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = actor) THEN
        actor := NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO "project_progress_history" ("project_id", "from_progress", "to_progress", "changed_by_id", "source", "changed_at")
        VALUES (NEW."id", NULL, NEW."progress", actor, 'insert', clock_timestamp());
    ELSIF NEW."progress" IS DISTINCT FROM OLD."progress" THEN
        INSERT INTO "project_progress_history" ("project_id", "from_progress", "to_progress", "changed_by_id", "source", "changed_at")
        VALUES (NEW."id", OLD."progress", NEW."progress", actor, 'update', clock_timestamp());
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "projects_progress_record_insert"
    AFTER INSERT ON "projects"
    FOR EACH ROW EXECUTE FUNCTION "project_progress_record"();

CREATE TRIGGER "projects_progress_record_update"
    AFTER UPDATE OF "progress" ON "projects"
    FOR EACH ROW WHEN (OLD."progress" IS DISTINCT FROM NEW."progress")
    EXECUTE FUNCTION "project_progress_record"();

-- The stage every project has now. Its earlier history was never stored, so this is the start of what can be reconstructed: the moment of
-- this migration is the earliest date Pipeline Growth can speak about.
INSERT INTO "project_progress_history" ("project_id", "from_progress", "to_progress", "changed_by_id", "source", "changed_at")
SELECT "id", NULL, "progress", NULL, 'baseline', clock_timestamp() FROM "projects";
