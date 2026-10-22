-- A project can be built on several principals (brands). Additive: a new link table; `projects.principal_id` stays and keeps the
-- first principal, so every list, filter and export that reads one name keeps working. Nothing is removed or rewritten there.
CREATE TABLE "project_principals" (
    "project_id" UUID NOT NULL,
    "principal_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_principals_pkey" PRIMARY KEY ("project_id", "principal_id")
);

CREATE INDEX "project_principals_principal_id_idx" ON "project_principals"("principal_id");

ALTER TABLE "project_principals" ADD CONSTRAINT "project_principals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_principals" ADD CONSTRAINT "project_principals_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every project that has a principal keeps it as the first (and so far only) link.
INSERT INTO "project_principals" ("project_id", "principal_id", "position")
SELECT "id", "principal_id", 0 FROM "projects" WHERE "principal_id" IS NOT NULL;
