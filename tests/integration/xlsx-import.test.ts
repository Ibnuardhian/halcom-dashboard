import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { suggestMapping } from "@/domain/projects/import";
import { toXlsx } from "@/server/export/xlsx";
import { commitProjectImport, previewProjectImport } from "@/server/import/xlsx-projects";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const HEADERS = ["End user", "Project", "Project ID", "Sales PIC", "Source", "External sales name", "Progress", "Status", "Estimated PO value", "Principals", "Solution", "Industry", "Target closing", "Quote released"];
type Row = (string | number | null)[];

/** A sheet as a .xlsx file, with the mapping the page would suggest from its headers. */
function sheet(rows: Row[], headers: string[] = HEADERS) {
  return { bytes: toXlsx("Pipeline", headers, rows), mapping: suggestMapping(headers) };
}

async function setup() {
  const [soa, sales, admin, purchasing, owner] = await Promise.all([makeUser("SOA"), makeUser("SALES"), makeUser("ADMIN"), makeUser("PURCHASING"), makeUser("SALES")]);
  const tag = randomBytes(3).toString("hex");
  const actor = (user: { id: string; role: Parameters<typeof previewProjectImport>[1]["role"] }) => ({ id: user.id, role: user.role });
  const good = (label: string, extra: Partial<Record<string, string | number>> = {}): Row => {
    const values: Record<string, string | number> = { "End user": `Import ${tag} ${label}`, Project: `Job ${label}`, "Sales PIC": owner.email, ...extra };
    return HEADERS.map((header) => values[header] ?? null);
  };
  return { soa, sales, admin, purchasing, owner, tag, actor, good };
}

describe("project import from an Excel sheet", () => {
  it("previews without writing: ready, duplicate and error rows are counted and explained row by row", async () => {
    const { soa, actor, good, tag, owner } = await setup();
    const existing = await createProject(db, actor(owner), { endUserCompany: `Import ${tag} old`, name: "Job old" });
    if (!existing.ok) throw new Error(existing.message);
    const before = await db.project.count();

    const { bytes, mapping } = sheet([
      good("a", { Progress: "30% - Propose", "Estimated PO value": 1500000, Principals: `Alpha ${tag}; Beta ${tag}`, "Target closing": "31/12/2026" }),
      good("a"), // the same end user and project twice in the file
      good("old"), // already in the database
      good("code", { "Project ID": existing.value.code }), // Project ID taken
      good("bad", { Progress: "maybe", "Estimated PO value": "-1", "Sales PIC": "Nobody At All" }),
      good("ok2", { "Sales PIC": owner.name === "Test SALES" ? owner.email.toUpperCase() : owner.email }), // an email in any case
    ]);

    const result = await previewProjectImport(db, actor(soa), { bytes, mapping });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({ totalRows: 6, ready: 2, duplicates: 3, errors: 1 });
    const byRow = new Map(result.summary.rows.map((row) => [row.sheetRow, row]));
    expect(byRow.get(3)?.messages[0]).toContain("baris 2 berkas ini"); // sheet row 3 is data row 2
    expect(byRow.get(4)).toMatchObject({ status: "duplicate", messages: [expect.stringContaining(existing.value.code)] });
    expect(byRow.get(5)).toMatchObject({ status: "duplicate", messages: [expect.stringContaining("sudah ada")] });
    expect(byRow.get(6)).toMatchObject({ status: "error", messages: expect.arrayContaining([expect.stringContaining('Progress "maybe"'), expect.stringContaining("Estimated PO value")]) });
    expect(result.summary.newPrincipals.sort()).toEqual([`Alpha ${tag}`, `Beta ${tag}`]);
    await expect(db.project.count()).resolves.toBe(before); // a preview writes nothing
    await expect(db.principal.count({ where: { nameKey: { endsWith: tag } } })).resolves.toBe(0);
  });

  it("imports the ready rows in one go: projects, owners, several principals, a solution, the update feed and the audit trail", async () => {
    const { soa, actor, good, tag, owner } = await setup();
    const { bytes, mapping } = sheet([
      good("one", {
        Progress: "30% - Propose",
        Status: "On Hold",
        "Estimated PO value": 2500000,
        Principals: `Alpha ${tag}; Beta ${tag}; alpha ${tag}`, // Alpha twice
        Solution: `Sol ${tag}`,
        Industry: "Banking",
        "Target closing": "2026-12-31",
        "Quote released": "2026-03-05",
      }),
      good("two", { Source: "Other", "Sales PIC": "", "External sales name": "PT Partner" }),
    ]);

    const result = await commitProjectImport(db, actor(soa), { bytes, mapping, fileName: "pipeline.xlsx", mode: "atomic" });

    expect(result).toMatchObject({ ok: true, created: 2, skippedDuplicates: 0, skippedInvalid: 0 });
    if (!result.ok) return;
    const one = await db.project.findUniqueOrThrow({ where: { code: result.codes[0]! }, include: { principals: { orderBy: { position: "asc" }, include: { principal: true } }, solutionCategory: true } });
    expect(one).toMatchObject({
      endUserCompany: `Import ${tag} one`,
      name: "Job one",
      salesOwnerId: owner.id,
      sourceType: "INTERNAL_SALES",
      progress: "PROPOSE",
      trackStatus: "ON_HOLD",
      industry: "Banking",
      importedFrom: "pipeline.xlsx",
    });
    expect(one.estimatedValue?.toNumber()).toBe(2500000);
    expect(one.targetDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(one.quoteReleasedAt?.toISOString().slice(0, 10)).toBe("2026-03-05");
    expect(one.principals.map((link) => link.principal.name)).toEqual([`Alpha ${tag}`, `Beta ${tag}`]); // once each, in order
    expect(one.principalId).toBe(one.principals[0]!.principalId);
    expect(one.solutionCategory?.name).toBe(`Sol ${tag}`);
    const two = await db.project.findUniqueOrThrow({ where: { code: result.codes[1]! } });
    expect(two).toMatchObject({ sourceType: "OTHER", salesOwnerId: null, externalSourceName: "PT Partner" });
    // Master data is created once, with the audit trail; every project and the import are in the audit log.
    await expect(db.principal.count({ where: { nameKey: { endsWith: tag } } })).resolves.toBe(2);
    await expect(db.auditEvent.count({ where: { action: "principal.created", entityType: "principal", after: { path: ["via"], equals: "import" } } })).resolves.toBeGreaterThanOrEqual(2);
    await expect(db.auditEvent.count({ where: { action: "project.imported", entityId: { in: [one.id, two.id] } } })).resolves.toBe(2);
    await expect(db.auditEvent.count({ where: { action: "import.projects", entityId: "pipeline.xlsx" } })).resolves.toBeGreaterThanOrEqual(1);
    // Running the same file again imports nothing: every row is now a duplicate, and nothing is updated.
    const again = await commitProjectImport(db, actor(soa), { bytes, mapping, fileName: "pipeline.xlsx", mode: "atomic" });
    expect(again).toMatchObject({ ok: false, code: "NOTHING_TO_IMPORT", summary: { duplicates: 2, ready: 0 } });
    await expect(db.project.findUniqueOrThrow({ where: { id: one.id } })).resolves.toMatchObject({ updatedAt: one.updatedAt });
  });

  it("all-or-nothing refuses the whole sheet while any row has a problem; skip-invalid imports only the valid rows", async () => {
    const { soa, actor, good } = await setup();
    const rows = [good("fine"), good("broken", { Status: "lost" }), good("fine2")];
    const { bytes, mapping } = sheet(rows);
    const before = await db.project.count();

    const atomic = await commitProjectImport(db, actor(soa), { bytes, mapping, fileName: "mixed.xlsx", mode: "atomic" });
    expect(atomic).toMatchObject({ ok: false, code: "HAS_ERRORS", summary: { ready: 2, errors: 1 } });
    await expect(db.project.count()).resolves.toBe(before);

    const skipping = await commitProjectImport(db, actor(soa), { bytes, mapping, fileName: "mixed.xlsx", mode: "skip-invalid" });
    expect(skipping).toMatchObject({ ok: true, created: 2, skippedInvalid: 1 });
    await expect(db.project.count()).resolves.toBe(before + 2);
  });

  it("rolls everything back when the import fails half way: no project, no principal, no code number, no audit row", async () => {
    const { soa, actor, good, tag } = await setup();
    const { bytes, mapping } = sheet([good("r1", { Principals: `Gamma ${tag}` }), good("r2"), good("r3")]);
    const before = {
      projects: await db.project.count(),
      counter: (await db.codeCounter.findUnique({ where: { scope: "HIT-PROJ-" } }))?.lastValue ?? 0,
      audit: await db.auditEvent.count({ where: { action: { in: ["project.imported", "import.projects", "principal.created"] } } }),
    };

    const result = await commitProjectImport(db, actor(soa), {
      bytes,
      mapping,
      fileName: "rollback.xlsx",
      mode: "atomic",
      afterRow: (index) => {
        if (index === 1) throw new Error("simulated failure on the second row");
      },
    });

    expect(result).toMatchObject({ ok: false, code: "FAILED" });
    await expect(db.project.count()).resolves.toBe(before.projects);
    await expect(db.project.count({ where: { importedFrom: "rollback.xlsx" } })).resolves.toBe(0);
    await expect(db.principal.count({ where: { nameKey: { endsWith: tag } } })).resolves.toBe(0);
    await expect(db.codeCounter.findUnique({ where: { scope: "HIT-PROJ-" } }).then((row) => row?.lastValue ?? 0)).resolves.toBe(before.counter);
    await expect(db.auditEvent.count({ where: { action: { in: ["project.imported", "import.projects", "principal.created"] } } })).resolves.toBe(before.audit);
    // The same sheet imports normally afterwards.
    await expect(commitProjectImport(db, actor(soa), { bytes, mapping, fileName: "rollback.xlsx", mode: "atomic" })).resolves.toMatchObject({ ok: true, created: 3 });
  });

  it("gives the next project numbers, and moves the counter past explicit Project IDs", async () => {
    const { soa, actor, good } = await setup();
    const high = `HIT-PROJ-${String(9000 + Math.floor(Math.random() * 900)).padStart(3, "0")}`;
    const { bytes, mapping } = sheet([good("auto1"), good("explicit", { "Project ID": high }), good("auto2")]);

    const result = await commitProjectImport(db, actor(soa), { bytes, mapping, fileName: "codes.xlsx", mode: "atomic" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const numbers = result.codes.map((code) => Number(code.slice(9)));
    expect(result.codes).toContain(high);
    // The rows without a Project ID were numbered after the explicit one, so nothing can collide.
    const auto = result.codes.filter((code) => code !== high).map((code) => Number(code.slice(9)));
    expect(auto.every((n) => n > Number(high.slice(9)))).toBe(true);
    expect(new Set(numbers).size).toBe(3);
  });

  it("only SOA and administrators may import; Sales, Purchasing, a deactivated account and a forged role are refused", async () => {
    const { soa, sales, purchasing, admin, actor, good } = await setup();
    const { bytes, mapping } = sheet([good("auth")]);

    for (const user of [sales, purchasing]) {
      await expect(previewProjectImport(db, actor(user), { bytes, mapping })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
      await expect(commitProjectImport(db, actor(user), { bytes, mapping, fileName: "x.xlsx", mode: "atomic" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    // A claimed role is checked against the stored account.
    await expect(previewProjectImport(db, { id: sales.id, role: "SOA" }, { bytes, mapping })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(commitProjectImport(db, { id: sales.id, role: "SOA" }, { bytes, mapping, fileName: "x.xlsx", mode: "atomic" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await db.user.update({ where: { id: soa.id }, data: { isActive: false } });
    await expect(previewProjectImport(db, actor(soa), { bytes, mapping })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(previewProjectImport(db, actor(admin), { bytes, mapping })).resolves.toMatchObject({ ok: true });
  });

  it("matches an existing principal by name (any case) instead of duplicating it, and leaves it untouched", async () => {
    const { soa, actor, good, tag } = await setup();
    const existing = await db.principal.create({ data: { name: `Known ${tag}`, nameKey: `known ${tag}` } });
    const { bytes, mapping } = sheet([good("known", { Principals: `known ${tag}` }), good("new", { Principals: `Brand New ${tag}` })]);

    const asSoa = await commitProjectImport(db, actor(soa), { bytes, mapping, fileName: "p.xlsx", mode: "atomic" });

    expect(asSoa).toMatchObject({ ok: true, created: 2 });
    await expect(db.principal.count({ where: { nameKey: `known ${tag}` } })).resolves.toBe(1); // matched, not duplicated
    await expect(db.principal.findUniqueOrThrow({ where: { id: existing.id } })).resolves.toMatchObject({ name: `Known ${tag}` });
    await expect(db.projectPrincipal.count({ where: { principalId: existing.id } })).resolves.toBe(1);
  });

  it("refuses a mapping that is incomplete, repeats a column or points outside the sheet, and a file that is not a workbook", async () => {
    const { soa, actor, good } = await setup();
    const { bytes, mapping } = sheet([good("m")]);

    await expect(previewProjectImport(db, actor(soa), { bytes, mapping: { ...mapping, name: null } })).resolves.toMatchObject({ ok: false, code: "INVALID_MAPPING" });
    await expect(previewProjectImport(db, actor(soa), { bytes, mapping: { ...mapping, name: mapping.endUser } })).resolves.toMatchObject({ ok: false, code: "INVALID_MAPPING" });
    await expect(previewProjectImport(db, actor(soa), { bytes, mapping: { ...mapping, name: 99 } })).resolves.toMatchObject({ ok: false, code: "INVALID_MAPPING" });
    await expect(previewProjectImport(db, actor(soa), { bytes, mapping: "nope" })).resolves.toMatchObject({ ok: false, code: "INVALID_MAPPING" });
    await expect(previewProjectImport(db, actor(soa), { bytes: new TextEncoder().encode("a,b\n1,2"), mapping })).resolves.toMatchObject({ ok: false, code: "INVALID_FILE" });
  });

  it("matches a salesperson by name only when exactly one account has it", async () => {
    const { soa, actor, good, tag } = await setup();
    const [a, b] = await Promise.all([makeUser("SALES"), makeUser("SALES")]);
    await db.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { name: `Twin ${tag}` } });
    const single = await makeUser("SALES");
    await db.user.update({ where: { id: single.id }, data: { name: `Solo ${tag}` } });
    const { bytes, mapping } = sheet([good("twin", { "Sales PIC": `twin ${tag}` }), good("solo", { "Sales PIC": `  SOLO  ${tag} ` })]);

    const result = await previewProjectImport(db, actor(soa), { bytes, mapping });

    expect(result.ok && result.summary).toMatchObject({ ready: 1, errors: 1 });
    expect(result.ok && result.summary.rows.find((row) => row.status === "error")?.messages[0]).toContain("cocok dengan 2 akun");
  });
});
