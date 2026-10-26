-- Technical sections of a project that an Admin or Superadmin adds (for example "Pre Assessment"), their values per project,
-- and the SOA phases as a list that can grow instead of a fixed enum. Nothing existing is changed or removed.

CREATE TABLE "technical_sections" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "label" TEXT NOT NULL,
    "label_key" TEXT NOT NULL,
    -- TEXT: free text, CHOICE: one of `options`.
    "kind" TEXT NOT NULL,
    "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "technical_sections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "technical_sections_kind_chk" CHECK ("kind" IN ('TEXT', 'CHOICE')),
    CONSTRAINT "technical_sections_label_not_blank_chk" CHECK (btrim("label") <> '')
);
CREATE UNIQUE INDEX "technical_sections_label_key_key" ON "technical_sections"("label_key");

CREATE TABLE "project_section_values" (
    "project_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "project_section_values_pkey" PRIMARY KEY ("project_id", "section_id")
);
CREATE INDEX "project_section_values_section_id_idx" ON "project_section_values"("section_id");
ALTER TABLE "project_section_values" ADD CONSTRAINT "project_section_values_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_section_values" ADD CONSTRAINT "project_section_values_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "technical_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "soa_phases" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "label_key" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "soa_phases_pkey" PRIMARY KEY ("key")
);
CREATE UNIQUE INDEX "soa_phases_label_key_key" ON "soa_phases"("label_key");
INSERT INTO "soa_phases" ("key", "label", "label_key", "position") VALUES
    ('ASSESSMENT', 'Assessment', 'assessment', 10),
    ('SIZING', 'Sizing', 'sizing', 20),
    ('POC', 'POC', 'poc', 30);

-- The phase of a request becomes a key of that list (the three old values keep their names).
ALTER TABLE "requests" ALTER COLUMN "phase" TYPE TEXT USING "phase"::text;
DROP TYPE "SoaPhase";
ALTER TABLE "requests" ADD CONSTRAINT "requests_phase_fkey" FOREIGN KEY ("phase") REFERENCES "soa_phases"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
