import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { suggestMapping } from "@/domain/projects/import";
import { toXlsx } from "@/server/export/xlsx";
import { commitProjectSync, previewProjectSync } from "@/server/import/xlsx-projects-sync";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

// Project ID first and End user third: the columns are found by name, not by position.
const HEADERS = ["Project ID", "Project", "End user", "Sales PIC", "Progress", "Principals"];
type Row = (string | number | null)[];
const sheet = (rows: Row[]) => ({ bytes: toXlsx("Pipeline", HEADERS, rows), mapping: suggestMapping(HEADERS) });

async function setup() {
  const [admin, owner, purchasing] = await Promise.all([makeUser("ADMIN"), makeUser("SALES"), makeUser("PURCHASING")]);
  const tag = randomBytes(3).toString("hex");
  const created = await createProject(db, { id: owner.id, role: owner.role }, { endUserCompany: `Sync ${tag} old`, name: "Job old" });
  if (!created.ok) throw new Error(created.message);
  const existing = await db.project.findUniqueOrThrow({ where: { id: created.value.id } });
  const row = (label: string, extra: Partial<Record<string, string>> = {}): Row => {
    const values: Record<string, string> = { Project: `Job ${label}`, "End user": `Sync ${tag} ${label}`, "Sales PIC": owner.email, ...extra };
    return HEADERS.map((header) => values[header] ?? null);
  };
  // A row that names an existing project the way the export does: its ID, and its own end user and name.
  const ofExisting = (extra: Partial<Record<string, string>> = {}) => row("old", { "Project ID": existing.code, Project: existing.name, "End user": existing.endUserCompany, ...extra });
  return { admin: { id: admin.id, role: admin.role }, owner, purchasing: { id: purchasing.id, role: purchasing.role }, tag, existing, row, ofExisting };
}

describe("one upload that adds and updates projects", () => {
  it("tells each row apart by its Project ID: update, new, unknown ID, duplicate and problem", async () => {
    const { admin, existing, row, ofExisting } = await setup();
    const { bytes, mapping } = sheet([
      row("a"), // no ID: a new project
      ofExisting({ Progress: "30% - Propose" }), // an ID that exists: update
      row("ghost", { "Project ID": "HIT-PROJ-999998" }), // an ID nobody has: skipped
      row("dup", { Project: existing.name, "End user": existing.endUserCompany }), // no ID, but the same project as an existing one
      row("bad", { Progress: "maybe" }),
    ]);

    const result = await previewProjectSync(db, admin, { bytes, mapping });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({ totalRows: 5, created: 1, updated: 1, skipped: 1, duplicates: 1, errors: 1 });
    const byRow = new Map(result.summary.rows.map((r) => [r.sheetRow, r]));
    expect(byRow.get(2)).toMatchObject({ status: "new", code: "" });
    expect(byRow.get(3)).toMatchObject({ status: "update", code: existing.code, changes: expect.arrayContaining([expect.objectContaining({ label: "Progress" })]) });
    expect(byRow.get(4)).toMatchObject({ status: "skipped", messages: [expect.stringContaining("kosongkan Project ID")] });
    expect(byRow.get(5)).toMatchObject({ status: "duplicate" });
    expect(byRow.get(6)).toMatchObject({ status: "error" });
    // The preview wrote nothing.
    expect(await db.project.count({ where: { name: "Job a" } })).toBe(0);
  });

  it("refuses everything while a row has a problem, and with skip-invalid writes the rest and tells the owner once", async () => {
    const { admin, owner, existing, row, ofExisting, tag } = await setup();
    const { bytes, mapping } = sheet([row("a"), row("b"), ofExisting({ Progress: "30% - Propose" }), row("bad", { Progress: "maybe" })]);

    const refused = await commitProjectSync(db, admin, { bytes, mapping, fileName: "mixed.xlsx", mode: "atomic", confirmNew: true });
    expect(refused).toMatchObject({ ok: false, code: "HAS_ERRORS" });
    expect(await db.project.count({ where: { endUserCompany: { startsWith: `Sync ${tag} ` } } })).toBe(1); // only the one set up

    const done = await commitProjectSync(db, admin, { bytes, mapping, fileName: "mixed.xlsx", mode: "skip-invalid", confirmNew: true });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.created.map((p) => p.name)).toEqual(["Job a", "Job b"]);
    expect(done.created.every((p) => /^HIT-PROJ-\d{3,}$/.test(p.code))).toBe(true);
    expect(done.updated).toEqual([expect.objectContaining({ code: existing.code, changes: expect.arrayContaining([expect.objectContaining({ label: "Progress", to: expect.stringContaining("Propose") })]) })]);
    expect(done.skippedInvalid).toBe(1);

    expect((await db.project.findUniqueOrThrow({ where: { id: existing.id } })).progress).toBe("PROPOSE");
    expect(await db.projectChange.count({ where: { projectId: existing.id, field: "progress" } })).toBeGreaterThan(0);
    // One notification for the Sales owner, listing what was added and what was changed.
    const notes = await db.notification.findMany({ where: { recipientId: owner.id, kind: "project.imported" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: "Import project: 2 baru, 1 diperbarui" });
    expect(notes[0]!.body).toContain(existing.code);
  });

  it("writes nothing when a row fails halfway, new projects and updates alike", async () => {
    const { admin, existing, row, ofExisting, tag } = await setup();
    const { bytes, mapping } = sheet([row("a"), row("b"), ofExisting({ Progress: "60% - Negotiate" })]);

    const failed = await commitProjectSync(db, admin, {
      bytes,
      mapping,
      fileName: "boom.xlsx",
      mode: "atomic",
      confirmNew: true,
      afterRow: (index) => {
        if (index === 1) throw new Error("boom");
      },
    });
    expect(failed).toMatchObject({ ok: false, code: "FAILED" });
    expect(await db.project.count({ where: { endUserCompany: { startsWith: `Sync ${tag} ` } } })).toBe(1);
    expect((await db.project.findUniqueOrThrow({ where: { id: existing.id } })).progress).toBe(existing.progress);
  });

  it("asks to confirm names it would create, and is refused to roles that may neither add nor update", async () => {
    const { admin, purchasing, row, tag } = await setup();
    const { bytes, mapping } = sheet([row("p", { Principals: `Brand ${tag}` })]);
    expect(await commitProjectSync(db, admin, { bytes, mapping, fileName: "p.xlsx", mode: "atomic", confirmNew: false })).toMatchObject({ ok: false, code: "NEEDS_CONFIRMATION" });
    expect(await previewProjectSync(db, purchasing, { bytes, mapping })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await commitProjectSync(db, purchasing, { bytes, mapping, fileName: "p.xlsx", mode: "atomic", confirmNew: true })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("treats every row as new when the sheet has no Project ID column", async () => {
    const { admin, owner, tag } = await setup();
    const headers = ["Project", "End user", "Sales PIC"];
    const bytes = toXlsx("Pipeline", headers, [["Job x", `Sync ${tag} x`, owner.email]]);
    const result = await previewProjectSync(db, admin, { bytes, mapping: suggestMapping(headers) });
    expect(result).toMatchObject({ ok: true, summary: { created: 1, updated: 0, errors: 0 } });
  });
});
