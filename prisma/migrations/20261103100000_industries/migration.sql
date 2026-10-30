-- The list of industries a customer can be given. A Superadmin edits it; the customer keeps the name as text, so nothing existing changes.
CREATE TABLE "industries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "industries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "industries_name_key_key" ON "industries"("name_key");

-- Start from the industries already in use, so no customer is left on a name that is not in the list.
INSERT INTO "industries" ("name", "name_key")
SELECT DISTINCT ON (lower(regexp_replace(trim(industry), '\s+', ' ', 'g')))
       regexp_replace(trim(industry), '\s+', ' ', 'g'), lower(regexp_replace(trim(industry), '\s+', ' ', 'g'))
FROM (
  SELECT industry FROM "customers" WHERE industry IS NOT NULL
  UNION ALL
  SELECT industry FROM "projects" WHERE industry IS NOT NULL AND deleted_at IS NULL
) used
WHERE trim(industry) <> ''
ORDER BY lower(regexp_replace(trim(industry), '\s+', ' ', 'g'));
