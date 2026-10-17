import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { authenticate } from "@/server/auth/authenticate";
import { importProjects } from "@/server/import/import-projects";
import { accountEmailFor, parseProjectsCsv, type ProjectImportRow } from "@/server/import/projects-csv";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
const PASSWORD = "import-test-password-1";

afterAll(async () => {
  await db.$disconnect();
});

const HEADER =
  '"Project ID","Customer","Project Name","Industry","Location","Sales PIC","Technical PIC","Principal","Solution","Project Description","Estimated Value","Probability","Target Closing","Stage","Status","Competitor","Competition Status","Requirement","Assessment Status","Solution Proposed","Architecture Status","Sizing Status","BOM Status","Quotation Status","Proposal Status","POC Status","Technical Challenge","Technical Blocker","Technical Notes","Current Action","Next Action","Scope Estimate","Lost Reason","Lost Notes","Won Date","Final Value","PIC / Stakeholder (raw)","Weighted Value","Custom Fields (JSON)"';
const COLUMNS = [...HEADER.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

function csvRow(values: Record<string, string>): string {
  return COLUMNS.map((column) => (values[column] === undefined ? "" : `"${values[column]!.replaceAll('"', '""')}"`)).join(",");
}

/** Unique per test, so tests sharing one database never collide on codes, people or master data. */
function fixture() {
  const tag = randomBytes(3).toString("hex");
  const first = 1000 + (parseInt(tag, 16) % 9_000_000); // far above anything the other tests create
  const code = (offset: number) => `PRJ-${first + offset}`;
  const sales = `Sales ${tag}`;
  const tech = `Tech ${tag}`;
  const rows = parseProjectsCsv(
    [
      HEADER,
      csvRow({
        "Project ID": code(0),
        Customer: `Customer ${tag}`,
        "Project Name": "Server AI",
        "Sales PIC": sales,
        "Technical PIC": tech,
        Principal: `HPE ${tag}`,
        Solution: `AI Server ${tag}`,
        "Estimated Value": "1200000000",
        Probability: "40",
        "Target Closing": "2026-12-10",
        Stage: "Negotiation",
        Status: "Active",
        "Current Action": "Line one\nLine two",
        "Technical Notes": "Sizing",
        "Custom Fields (JSON)": '{"a":1}',
      }),
      csvRow({
        "Project ID": code(1),
        Customer: ` customer  ${tag.toUpperCase()} `,
        "Project Name": "Storage",
        "Sales PIC": sales,
        "Technical PIC": tech,
        Principal: `hpe  ${tag}`,
        Solution: `AI Server ${tag}`,
        Stage: "Won",
        Status: "Won",
        "Final Value": "400000000",
        "Won Date": "2026-10-05",
      }),
      csvRow({ "Project ID": code(2), Customer: `Someone Else ${tag}`, "Project Name": "No brand", "Sales PIC": sales, Stage: "Lost", Status: "Lost", "Lost Reason": "Price" }),
    ].join("\n"),
  );
  expect(rows.problems).toEqual([]);
  return { tag, rows: rows.rows, sales, tech, codes: [code(0), code(1), code(2)] };
}

describe("importProjects", () => {
  it("creates the projects with their master data and people in one go, and writes audit events", async () => {
    const f = fixture();

    const summary = await importProjects(db, f.rows, { source: "test.csv", password: PASSWORD });

    expect(summary.projectsToCreate).toEqual(f.codes);
    expect(summary.usersToCreate).toEqual([`${f.sales} (SALES)`, `${f.tech} (SOA)`]);
    expect(summary).toMatchObject({ customers: 2, principals: 1, solutionCategories: 1 }); // "HPE x" and "hpe  x" are one principal

    const projects = await db.project.findMany({
      where: { code: { in: f.codes } },
      orderBy: { code: "asc" },
      include: { customer: true, principal: true, solutionCategory: true, salesOwner: true, technicalPic: true },
    });
    expect(projects).toHaveLength(3);
    const byCode = Object.fromEntries(projects.map((p) => [p.code, p]));
    const big = byCode[f.codes[0]!]!;
    expect(big).toMatchObject({
      endUserCompany: `Customer ${f.tag}`,
      name: "Server AI",
      status: "ACTIVE",
      stage: "NEGOTIATION",
      probability: 40,
      currentAction: "Line one\nLine two",
      technicalNotes: "Sizing",
      customFields: { a: 1 },
      importedFrom: "test.csv",
      industry: null,
    });
    expect(Number(big.estimatedValue)).toBe(1_200_000_000);
    expect(big.targetDate?.toISOString().slice(0, 10)).toBe("2026-12-10");
    expect(big.salesOwner).toMatchObject({ name: f.sales, role: "SALES", email: accountEmailFor(f.sales) });
    expect(big.technicalPic).toMatchObject({ name: f.tech, role: "SOA" });
    expect(big.principal?.name).toBe(`HPE ${f.tag}`);

    const won = byCode[f.codes[1]!]!;
    expect(won).toMatchObject({ status: "WON", stage: "WON", principalId: big.principalId, customerId: big.customerId });
    expect(Number(won.finalValue)).toBe(400_000_000);
    expect(won.wonDate?.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(byCode[f.codes[2]!]).toMatchObject({ status: "LOST", lostReason: "Price", principalId: null, technicalPicId: null });

    // The export's current / next action became the first entries of the project's feed, without an author.
    const feed = await db.projectAction.findMany({ where: { projectId: big.id }, orderBy: { kind: "asc" } });
    expect(feed.map((e) => [e.kind, e.body, e.authorId])).toEqual([["CURRENT", "Line one\nLine two", null]]);
    await expect(db.projectAction.count({ where: { projectId: byCode[f.codes[2]!]!.id } })).resolves.toBe(0);

    await expect(authenticate(db, accountEmailFor(f.sales), PASSWORD)).resolves.toMatchObject({ role: "SALES" });
    const events = await db.auditEvent.findMany({ where: { entityType: "project", action: "project.imported", entityId: { in: projects.map((p) => p.id) } } });
    expect(events).toHaveLength(3);
    await expect(db.auditEvent.count({ where: { action: "import.projects", entityId: "test.csv" } })).resolves.toBeGreaterThanOrEqual(1);
  });

  it("is safe to run again: nothing is duplicated, changed or overwritten", async () => {
    const f = fixture();
    await importProjects(db, f.rows, { source: "again.csv", password: PASSWORD });
    await db.project.update({ where: { code: f.codes[0]! }, data: { currentAction: "Edited in the app" } });
    await db.user.update({ where: { email: accountEmailFor(f.sales) }, data: { role: "ADMIN" } });

    const second = await importProjects(db, f.rows, { source: "again.csv", password: "a-different-password-9" });

    expect(second.projectsToCreate).toEqual([]);
    expect(second.projectsExisting).toEqual(f.codes);
    expect(second.usersToCreate).toEqual([]);
    expect(second).toMatchObject({ customers: 0, principals: 0, solutionCategories: 0 });
    await expect(db.project.count({ where: { code: { in: f.codes } } })).resolves.toBe(3);
    await expect(db.project.findUniqueOrThrow({ where: { code: f.codes[0]! } })).resolves.toMatchObject({ currentAction: "Edited in the app" });
    await expect(db.user.findUniqueOrThrow({ where: { email: accountEmailFor(f.sales) } })).resolves.toMatchObject({ role: "ADMIN" });
    await expect(authenticate(db, accountEmailFor(f.sales), PASSWORD)).resolves.not.toBeNull(); // password unchanged
  });

  it("a dry run reports the plan and writes nothing", async () => {
    const f = fixture();

    const summary = await importProjects(db, f.rows, { source: "dry.csv", password: PASSWORD, dryRun: true });

    expect(summary).toMatchObject({ dryRun: true, projectsToCreate: f.codes });
    await expect(db.project.count({ where: { code: { in: f.codes } } })).resolves.toBe(0);
    await expect(db.user.count({ where: { email: accountEmailFor(f.sales) } })).resolves.toBe(0);
    await expect(db.customer.count({ where: { nameKey: `customer ${f.tag}` } })).resolves.toBe(0);
  });

  it("imports nothing when one row is rejected by the database", async () => {
    const f = fixture();
    const poisoned: ProjectImportRow[] = f.rows.map((row, index) => (index === 2 ? { ...row, probability: 150 } : row));

    await expect(importProjects(db, poisoned, { source: "bad.csv", password: PASSWORD })).rejects.toThrow(/projects_probability_range_chk/);

    await expect(db.project.count({ where: { code: { in: f.codes } } })).resolves.toBe(0);
    await expect(db.user.count({ where: { email: accountEmailFor(f.sales) } })).resolves.toBe(0);
    await expect(db.customer.count({ where: { nameKey: `customer ${f.tag}` } })).resolves.toBe(0);
  });

  it("continues the project numbering after the highest imported code", async () => {
    const f = fixture();
    await importProjects(db, f.rows, { source: "counter.csv", password: PASSWORD });
    const highest = Math.max(...f.codes.map((c) => Number(c.slice(4))));
    const sales = await makeUser("SALES");

    const created = await createProject(db, { id: sales.id, role: "SALES" }, { endUserCompany: `Customer ${f.tag}`, name: "Created later" });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(Number(created.value.code.slice(4))).toBeGreaterThan(highest);
    const project = await db.project.findUniqueOrThrow({ where: { id: created.value.id }, include: { customer: true } });
    expect(project.customer?.nameKey).toBe(`customer ${f.tag}`); // linked to the customer the import already made
  });
});

describe("database rules for the pipeline fields", () => {
  it("rejects an out-of-range probability, a negative value and a malformed project code", async () => {
    const sales = await makeUser("SALES");
    const base = { endUserCompany: "A", name: "B", salesOwnerId: sales.id };

    await expect(db.project.create({ data: { ...base, code: "PRJ-701", probability: 101 } })).rejects.toThrow(/projects_probability_range_chk/);
    await expect(db.project.create({ data: { ...base, code: "PRJ-702", estimatedValue: -1 } })).rejects.toThrow(/projects_values_not_negative_chk/);
    await expect(db.project.create({ data: { ...base, code: "PRJ-7" } })).rejects.toThrow(/projects_code_format_chk/);
    await expect(db.project.create({ data: { ...base, code: "PRJ-703", probability: 0, estimatedValue: 0 } })).resolves.toBeDefined();
  });

  it("keeps master-data names unique regardless of case and spacing", async () => {
    const tag = randomBytes(3).toString("hex");
    await db.principal.create({ data: { name: `Dell ${tag}`, nameKey: `dell ${tag}` } });

    await expect(db.principal.create({ data: { name: `DELL ${tag}`, nameKey: `dell ${tag}` } })).rejects.toThrow(/Unique constraint|name_key/);
    await expect(db.principal.create({ data: { name: `Dell  ${tag}`, nameKey: `dell  ${tag}` } })).rejects.toThrow(/principals_name_key_normalised_chk/);
  });
});
