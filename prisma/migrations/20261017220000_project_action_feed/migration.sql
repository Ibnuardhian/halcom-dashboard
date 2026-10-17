-- CreateEnum
CREATE TYPE "ProjectActionKind" AS ENUM ('CURRENT', 'NEXT');

-- CreateTable
CREATE TABLE "project_actions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" "ProjectActionKind" NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_actions_project_id_created_at_idx" ON "project_actions"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_actions_project_id_kind_created_at_idx" ON "project_actions"("project_id", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "project_actions" ADD CONSTRAINT "project_actions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_actions" ADD CONSTRAINT "project_actions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_actions" ADD CONSTRAINT "project_actions_body_not_blank_chk"
    CHECK (btrim("body") <> '');

-- The feed starts from what the projects already hold: each existing current and next action becomes the
-- first entry of its kind (no author: it came from the import). Nothing is removed from `projects`.
INSERT INTO "project_actions" ("id", "project_id", "kind", "body", "author_id", "created_at")
SELECT uuidv7(), "id", 'CURRENT', btrim("current_action"), NULL, "updated_at"
FROM "projects" WHERE "current_action" IS NOT NULL AND btrim("current_action") <> '';

INSERT INTO "project_actions" ("id", "project_id", "kind", "body", "author_id", "created_at")
SELECT uuidv7(), "id", 'NEXT', btrim("next_action"), NULL, "updated_at"
FROM "projects" WHERE "next_action" IS NOT NULL AND btrim("next_action") <> '';

-- project_actions is append-only: reject UPDATE, DELETE and TRUNCATE.
CREATE FUNCTION "project_actions_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'project_actions is append-only (% rejected)', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "project_actions_no_update_delete"
    BEFORE UPDATE OR DELETE ON "project_actions"
    FOR EACH ROW EXECUTE FUNCTION "project_actions_reject_change"();

CREATE TRIGGER "project_actions_no_truncate"
    BEFORE TRUNCATE ON "project_actions"
    FOR EACH STATEMENT EXECUTE FUNCTION "project_actions_reject_change"();
