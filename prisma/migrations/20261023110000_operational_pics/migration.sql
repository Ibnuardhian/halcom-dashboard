-- Operational PICs. SOA and Purchasing each sign in with one shared account; the tickets are handed to individual PICs, who are not
-- login accounts. Additive: new tables and one new nullable column on requests. `requests.assignee_id` stays (deprecated, no longer
-- written) so nothing that was assigned before is lost.
CREATE TYPE "PicTeam" AS ENUM ('SOA', 'PURCHASING');

CREATE TABLE "pics" (
    "id" UUID NOT NULL,
    "team" "PicTeam" NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pics_team_name_key_key" ON "pics"("team", "name_key");
CREATE INDEX "pics_team_is_active_idx" ON "pics"("team", "is_active");

-- The key is the trimmed, single-spaced, lower-cased name, whatever code writes the row.
ALTER TABLE "pics" ADD CONSTRAINT "pics_name_key_chk"
    CHECK ("name_key" = lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')) AND "name_key" <> '');

ALTER TABLE "requests" ADD COLUMN "pic_id" UUID;
CREATE INDEX "requests_pic_id_idx" ON "requests"("pic_id");
ALTER TABLE "requests" ADD CONSTRAINT "requests_pic_id_fkey" FOREIGN KEY ("pic_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "request_pic_assignments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "from_pic_id" UUID,
    "to_pic_id" UUID,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_pic_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "request_pic_assignments_request_id_changed_at_idx" ON "request_pic_assignments"("request_id", "changed_at");
CREATE INDEX "request_pic_assignments_to_pic_id_idx" ON "request_pic_assignments"("to_pic_id");

ALTER TABLE "request_pic_assignments" ADD CONSTRAINT "request_pic_assignments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_pic_assignments" ADD CONSTRAINT "request_pic_assignments_from_pic_id_fkey" FOREIGN KEY ("from_pic_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_pic_assignments" ADD CONSTRAINT "request_pic_assignments_to_pic_id_fkey" FOREIGN KEY ("to_pic_id") REFERENCES "pics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "request_pic_assignments" ADD CONSTRAINT "request_pic_assignments_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- request_pic_assignments is append-only: reject UPDATE, DELETE and TRUNCATE.
CREATE FUNCTION "request_pic_assignments_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'request_pic_assignments is append-only (% rejected)', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "request_pic_assignments_no_update_delete"
    BEFORE UPDATE OR DELETE ON "request_pic_assignments"
    FOR EACH ROW EXECUTE FUNCTION "request_pic_assignments_reject_change"();

CREATE TRIGGER "request_pic_assignments_no_truncate"
    BEFORE TRUNCATE ON "request_pic_assignments"
    FOR EACH STATEMENT EXECUTE FUNCTION "request_pic_assignments_reject_change"();

-- Start from what is recorded: every SOA or Purchasing account that a request was assigned to becomes a PIC of its team (same name),
-- and those requests point at it. Nothing is guessed about people who were never assigned anything; the accounts themselves stay.
INSERT INTO "pics" ("id", "team", "name", "name_key", "updated_at")
SELECT uuidv7(), u."role"::text::"PicTeam", btrim(u."name"), lower(regexp_replace(btrim(u."name"), '\s+', ' ', 'g')), CURRENT_TIMESTAMP
FROM "users" u
WHERE u."role" IN ('SOA', 'PURCHASING')
  AND btrim(u."name") <> ''
  AND EXISTS (SELECT 1 FROM "requests" r WHERE r."assignee_id" = u."id")
ON CONFLICT ("team", "name_key") DO NOTHING;

UPDATE "requests" r
SET "pic_id" = p."id"
FROM "users" u
JOIN "pics" p ON p."team" = u."role"::text::"PicTeam" AND p."name_key" = lower(regexp_replace(btrim(u."name"), '\s+', ' ', 'g'))
WHERE r."assignee_id" = u."id" AND r."pic_id" IS NULL;
