-- Project IDs change from PRJ-001 to HIT-PROJ-001. Existing projects are renamed in place (their ids, requests and history
-- are untouched; nothing else stores the code) and the counter moves to the new scope, so the next project continues the sequence.
ALTER TABLE "projects" DROP CONSTRAINT "projects_code_format_chk";
UPDATE "projects" SET "code" = 'HIT-PROJ-' || substr("code", 5) WHERE "code" LIKE 'PRJ-%';
ALTER TABLE "projects" ADD CONSTRAINT "projects_code_format_chk" CHECK ("code" ~ '^HIT-PROJ-[0-9]{3,}$');

UPDATE "code_counters" SET "scope" = 'HIT-PROJ-' WHERE "scope" = 'PRJ-';

-- Notifications keep the code in their text and link.
UPDATE "notifications" SET
    "title" = replace("title", 'PRJ-', 'HIT-PROJ-'),
    "body" = replace("body", 'PRJ-', 'HIT-PROJ-'),
    "href" = replace("href", 'PRJ-', 'HIT-PROJ-')
WHERE "title" LIKE '%PRJ-%' OR "body" LIKE '%PRJ-%' OR "href" LIKE '%PRJ-%';
