import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { IMPORT_FIELD_KEYS, importRowOf, suggestMapping, templateHeaders } from "@/domain/projects/import";
import { importScope, scopedFieldKeys } from "@/domain/projects/import-scope";
import { toXlsx } from "@/server/export/xlsx";
import { commitProjectUpdate, previewProjectUpdate } from "@/server/import/xlsx-projects-update";
import { listProjectsForExport } from "@/server/projects/export";
import { listProjectChanges } from "@/server/projects/queries";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

type Cell = string | number | null;
const HEADERS = templateHeaders();
const column = (label: string) => HEADERS.findIndex((header) => header.replace(/ \*$/, "") === label);

async function setup() {
  const [admin, root, soa, sales, newOwner] = await Promise.all([makeUser("ADMIN"), makeUser("SUPERADMIN"), makeUser("SOA"), makeUser("SALES"), makeUser("SALES")]);
  const tag = randomBytes(3).toString("hex");
  const as = (user: { id: string; role: Parameters<typeof previewProjectUpdate>[1]["role"] }) => ({ id: user.id, role: user.role });
  const created = await createProject(db, as(sales), { endUserCompany: `Bulk ${tag}`, name: `Job ${tag}` });
  if (!created.ok) throw new Error(created.message);
  const code = created.value.code;

  /** The project as the export writes it, with some cells changed (by header) and others emptied. */
  async function exported(changes: Record<string, Cell> = {}, onlyCodes: string[] = [code]): Promise<Cell[][]> {
    const projects = (await listProjectsForExport(db, as(root))).filter((project) => onlyCodes.includes(project.code));
    return projects.map((project) => {
      const cells = importRowOf(project);
      for (const [label, value] of Object.entries(changes)) cells[column(label)] = value;
      return cells;
    });
  }
  const file = (rows: Cell[][]) => ({ bytes: toXlsx("Projects", HEADERS, rows), mapping: suggestMapping(HEADERS) });
  return { admin, root, soa, sales, newOwner, tag, code, as, exported, file, projectId: created.value.id };
}

describe("bulk update of projects from an Excel sheet", () => {
  it("is for those who hold the permission: Superadmin, Admin, SOA and Sales, not Purchasing or Finance", async () => {
    const { admin, as, file, exported } = await setup();
    const [purchasing, finance] = await Promise.all([makeUser("PURCHASING"), makeUser("FINANCE")]);
    const input = file(await exported());
    for (const user of [purchasing, finance]) expect(await previewProjectUpdate(db, as(user), input)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await commitProjectUpdate(db, as(purchasing), { ...input, fileName: "x.xlsx", confirmNew: true })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await previewProjectUpdate(db, as(admin), input)).toMatchObject({ ok: true });
  });

  it("an export that was not edited changes nothing", async () => {
    const { admin, as, file, exported } = await setup();
    const preview = await previewProjectUpdate(db, as(admin), file(await exported()));
    expect(preview).toMatchObject({ ok: true, summary: { toUpdate: 0, unchanged: 1, errors: 0 } });
    expect(await commitProjectUpdate(db, as(admin), { ...file(await exported()), fileName: "same.xlsx", confirmNew: true })).toMatchObject({ ok: false, code: "NOTHING_TO_UPDATE" });
  });

  it("changes end user, Sales PIC and principals (replacing them all), asks before creating a new name, and logs each change", async () => {
    const { admin, newOwner, tag, code, as, file, exported, projectId, sales } = await setup();
    const changes = { "End user": `Bulk ${tag} Renamed`, "Sales PIC": newOwner.email, Principals: `Bulk HPE ${tag}; Bulk Aruba ${tag}`, "Estimated PO value": 5000 };
    const input = file(await exported(changes));

    const preview = await previewProjectUpdate(db, as(admin), input);
    expect(preview).toMatchObject({ ok: true, summary: { toUpdate: 1, errors: 0, newCustomers: [`Bulk ${tag} Renamed`], newPrincipals: [`Bulk HPE ${tag}`, `Bulk Aruba ${tag}`] } });

    // New names are created only once the person confirms them, and nothing is written before that.
    expect(await commitProjectUpdate(db, as(admin), { ...input, fileName: "bulk.xlsx", confirmNew: false })).toMatchObject({ ok: false, code: "NEEDS_CONFIRMATION" });
    await expect(db.project.findUniqueOrThrow({ where: { id: projectId } })).resolves.toMatchObject({ endUserCompany: `Bulk ${tag}`, salesOwnerId: sales.id });

    const done = await commitProjectUpdate(db, as(admin), { ...input, fileName: "bulk.xlsx", confirmNew: true });
    expect(done).toMatchObject({ ok: true, updated: 1, codes: [code] });
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { principals: { orderBy: { position: "asc" }, include: { principal: true } }, customer: true } });
    expect(project).toMatchObject({ endUserCompany: `Bulk ${tag} Renamed`, salesOwnerId: newOwner.id });
    expect(project.customer?.name).toBe(`Bulk ${tag} Renamed`);
    expect(project.estimatedValue?.toNumber()).toBe(5000);
    expect(project.principals.map((link) => link.principal.name)).toEqual([`Bulk HPE ${tag}`, `Bulk Aruba ${tag}`]);
    expect(project.principalId).toBe(project.principals[0]!.principalId);

    const log = await listProjectChanges(db, as(admin), projectId);
    expect(log.map((row) => row.field)).toEqual(expect.arrayContaining(["endUserCompany", "salesOwner", "principal", "estimatedValue"]));
    expect(log.find((row) => row.field === "endUserCompany")).toMatchObject({ fromValue: `Bulk ${tag}`, toValue: `Bulk ${tag} Renamed` });
    await expect(db.auditEvent.count({ where: { action: "project.bulk_updated", entityId: projectId } })).resolves.toBe(1);
    await expect(db.notification.count({ where: { recipientId: sales.id, kind: "project.reassigned" } })).resolves.toBeGreaterThan(0);

    // The same sheet again: the principals now match, so nothing is left to change.
    const again = await exported({ "End user": `Bulk ${tag} Renamed`, "Sales PIC": newOwner.email, Principals: `Bulk HPE ${tag}; Bulk Aruba ${tag}` });
    expect(await previewProjectUpdate(db, as(admin), file(again))).toMatchObject({ ok: true, summary: { toUpdate: 0, unchanged: 1 } });
  });

  it("an empty cell changes nothing, and a name that exists is matched without a confirmation", async () => {
    const { admin, tag, as, file, exported, projectId } = await setup();
    await db.industry.create({ data: { name: `Retail ${tag}`, nameKey: `retail ${tag}` } });
    const first = await commitProjectUpdate(db, as(admin), { ...file(await exported({ Principals: `Bulk Brand ${tag}`, Industry: `Retail ${tag}` })), fileName: "a.xlsx", confirmNew: true });
    expect(first.ok).toBe(true);
    // Principals and Industry are empty in this sheet; the project keeps both. Only the description is filled.
    const second = await commitProjectUpdate(db, as(admin), { ...file(await exported({ Principals: null, Industry: null, Description: "Edited" })), fileName: "b.xlsx", confirmNew: false });
    expect(second.ok).toBe(true);
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { principals: true, customer: true } });
    expect(project).toMatchObject({ description: "Edited" });
    expect(project.customer?.industry).toBe(`Retail ${tag}`);
    expect(project.principals).toHaveLength(1);
    // The principal that exists is matched in any letter case, so no confirmation is needed.
    const matched = await previewProjectUpdate(db, as(admin), file(await exported({ Principals: `BULK BRAND ${tag}`, Description: "Edited again" })));
    expect(matched).toMatchObject({ ok: true, summary: { toUpdate: 1, newPrincipals: [] } });
  });

  it("refuses a project that changed after the export, an unknown source change and a Sales PIC that is not an account, all or nothing", async () => {
    const { admin, as, file, exported, projectId, code } = await setup();
    const stale = await exported({ Description: "From an old export" });
    await db.project.update({ where: { id: projectId }, data: { location: "Changed meanwhile" } });
    expect(await previewProjectUpdate(db, as(admin), file(stale))).toMatchObject({ ok: true, summary: { errors: 1, toUpdate: 0 } });
    expect(await commitProjectUpdate(db, as(admin), { ...file(stale), fileName: "stale.xlsx", confirmNew: true })).toMatchObject({ ok: false, code: "HAS_ERRORS" });

    const bad = await exported({ "Sales PIC": "nobody@nowhere.invalid", Description: "Never saved" });
    const outcome = await commitProjectUpdate(db, as(admin), { ...file(bad), fileName: "bad.xlsx", confirmNew: true });
    expect(outcome).toMatchObject({ ok: false, code: "HAS_ERRORS" });
    await expect(db.project.findUniqueOrThrow({ where: { id: projectId } })).resolves.toMatchObject({ code, description: null });
  });

  it("skips rows with no Project ID or an unknown one, and refuses the same Project ID twice", async () => {
    const { admin, as, file, exported, code } = await setup();
    const [row] = await exported({ Description: "Twice" });
    const unknown = [...row!];
    unknown[column("Project ID")] = "HIT-PROJ-999999";
    const none = [...row!];
    none[column("Project ID")] = null;
    const preview = await previewProjectUpdate(db, as(admin), file([unknown, none]));
    expect(preview).toMatchObject({ ok: true, summary: { skipped: 2, toUpdate: 0 } });

    const twice = await previewProjectUpdate(db, as(admin), file([row!, row!]));
    expect(twice).toMatchObject({ ok: true, summary: { toUpdate: 1, errors: 1 } });
    expect(code).toMatch(/^HIT-PROJ-/);
  });

  it("moves Progress with the same stage-date rules as the project form", async () => {
    const { admin, as, file, exported, projectId } = await setup();
    const done = await commitProjectUpdate(db, as(admin), { ...file(await exported({ Progress: "30% - Propose" })), fileName: "p.xlsx", confirmNew: true });
    expect(done.ok).toBe(true);
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.progress).toBe("PROPOSE");
    expect(project.quoteReleasedAt).not.toBeNull(); // Propose with no date fills today, as the form does
  });
});

describe("each role updates only its part of the sheet", () => {
  type Role = Parameters<typeof previewProjectUpdate>[1]["role"];
  const KEYS = (role: Role) => scopedFieldKeys(importScope(role), IMPORT_FIELD_KEYS);
  const labelsOf = (role: Role) => templateHeaders(KEYS(role)).map((header) => header.replace(/ \*$/, ""));

  /** A sheet shaped like the role's export: only its columns, the project's values, some cells changed. */
  async function sheet(role: Role, viewer: { id: string; role: Role }, code: string, changes: Record<string, Cell> = {}) {
    const keys = KEYS(role);
    const headers = templateHeaders(keys);
    const project = (await listProjectsForExport(db, viewer)).find((entry) => entry.code === code)!;
    const cells = importRowOf(project, keys);
    for (const [label, value] of Object.entries(changes)) cells[labelsOf(role).indexOf(label)] = value;
    return { bytes: toXlsx("Projects", headers, [cells]), mapping: suggestMapping(headers) };
  }
  const actor = (user: { id: string; role: Role }) => ({ id: user.id, role: user.role });

  it("gives Sales the commercial columns and SOA the technical ones, and keeps the money from SOA", () => {
    const sales = labelsOf("SALES");
    const soa = labelsOf("SOA");
    expect(sales).toEqual(expect.arrayContaining(["Progress", "Estimated PO value", "Target margin (%)", "Industry", "Location"]));
    expect(sales).not.toEqual(expect.arrayContaining(["Principals"]));
    expect(soa).toEqual(expect.arrayContaining(["Principals", "Solution", "Sales PIC", "Industry", "Location", "Project ID", "Last updated"]));
    for (const money of ["Progress", "Status", "Estimated PO value", "Target margin (amount)", "Target margin (%)", "Quote released", "Target closing"]) expect(soa).not.toContain(money);
    expect(labelsOf("ADMIN")).toEqual(templateHeaders().map((header) => header.replace(/ \*$/, "")));
  });

  it("lets SOA change principals and solution but refuses a commercial change, naming the column", async () => {
    const { soa, tag, code, as } = await setup();
    const ok = await previewProjectUpdate(db, as(soa), await sheet("SOA", actor(soa), code, { Principals: `Scope ${tag}` }));
    expect(ok).toMatchObject({ ok: true, summary: { toUpdate: 1, errors: 0 } });

    // A commercial column added to the sheet by hand does nothing: the row is refused.
    const bytes = toXlsx("Projects", [...templateHeaders(KEYS("SOA")), "Estimated PO value"], [[...importRowOf((await listProjectsForExport(db, actor(soa))).find((entry) => entry.code === code)!, KEYS("SOA")), 9999]]);
    const headers = [...templateHeaders(KEYS("SOA")), "Estimated PO value"];
    const refused = await previewProjectUpdate(db, as(soa), { bytes, mapping: suggestMapping(headers) });
    expect(refused).toMatchObject({ ok: true, summary: { errors: 1, toUpdate: 0 } });
    expect(JSON.stringify(refused)).toContain("kolom commercial");
  });

  it("lets Sales change commercial fields of their own projects only", async () => {
    const { sales, newOwner, code, projectId, as } = await setup();
    const mine = await commitProjectUpdate(db, as(sales), { ...(await sheet("SALES", actor(sales), code, { Progress: "Propose", "Estimated PO value": 7000 })), fileName: "mine.xlsx", confirmNew: false });
    expect(mine).toMatchObject({ ok: true, updated: 1 });
    await expect(db.project.findUniqueOrThrow({ where: { id: projectId } })).resolves.toMatchObject({ progress: "PROPOSE" });

    // Another salesperson's project is not theirs to update, and is not in their export.
    const theirs = await previewProjectUpdate(db, as(newOwner), await sheet("SALES", actor(sales), code, { Progress: "Negotiate" }));
    expect(theirs).toMatchObject({ ok: true, summary: { errors: 1, toUpdate: 0 } });
    expect((await listProjectsForExport(db, actor(newOwner), newOwner.id)).some((entry) => entry.code === code)).toBe(false);
    expect((await listProjectsForExport(db, actor(sales), sales.id)).some((entry) => entry.code === code)).toBe(true);
  });

  it("refuses a technical change from Sales", async () => {
    const { sales, tag, code, as } = await setup();
    const headers = templateHeaders(KEYS("SALES"));
    const row = importRowOf((await listProjectsForExport(db, actor(sales))).find((entry) => entry.code === code)!, KEYS("SALES"));
    const withBrand = toXlsx("Projects", [...headers, "Principals"], [[...row, `Sneaky ${tag}`]]);
    const result = await previewProjectUpdate(db, as(sales), { bytes: withBrand, mapping: suggestMapping([...headers, "Principals"]) });
    expect(result).toMatchObject({ ok: true, summary: { errors: 1, toUpdate: 0 } });
    expect(JSON.stringify(result)).toContain("Principals atau Solution");
  });

  it("sets the industry on the customer, from the list, for Sales and for SOA", async () => {
    const { sales, soa, tag, code, as, projectId } = await setup();
    const listed = await db.industry.create({ data: { name: `Scope Industry ${tag}`, nameKey: `scope industry ${tag}` } });
    const unlisted = await previewProjectUpdate(db, as(soa), await sheet("SOA", actor(soa), code, { Industry: `Not Listed ${tag}` }));
    expect(unlisted).toMatchObject({ ok: true, summary: { errors: 1 } });

    const done = await commitProjectUpdate(db, as(soa), { ...(await sheet("SOA", actor(soa), code, { Industry: listed.name.toUpperCase(), Location: "Padang" })), fileName: "industry.xlsx", confirmNew: false });
    expect(done).toMatchObject({ ok: true, updated: 1 });
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { customer: true } });
    expect(project.customer?.industry).toBe(listed.name);
    expect(project.location).toBe("Padang");

    // Sales may set it as well; naming the current industry again is no change.
    const again = await previewProjectUpdate(db, as(sales), await sheet("SALES", actor(sales), code, { Industry: listed.name }));
    expect(again).toMatchObject({ ok: true, summary: { toUpdate: 0, unchanged: 1 } });
  });
});
