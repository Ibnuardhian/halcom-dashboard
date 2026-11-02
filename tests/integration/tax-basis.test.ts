import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { DEFAULT_TAX_BASIS } from "@/domain/projects/tax-basis";
import { listProjectsForExport } from "@/server/projects/export";
import { updateCommercialDetails } from "@/server/projects/service";
import { getTaxBasis, saveTaxBasis } from "@/server/settings/app-settings";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: "pricing.tax-basis" } });
  await db.$disconnect();
});

describe("the PPN basis of the value and the margin", () => {
  it("is set by a Superadmin, audited, refused to others, and moves the gross profit and the margin percentage", async () => {
    const [root, admin, sales] = await Promise.all([makeUser("SUPERADMIN"), makeUser("ADMIN"), makeUser("SALES")]);
    await db.appSetting.deleteMany({ where: { key: "pricing.tax-basis" } });
    expect(await getTaxBasis(db)).toEqual(DEFAULT_TAX_BASIS);

    const created = await createProject(db, { id: sales.id, role: sales.role }, { endUserCompany: "Tax Co", name: "Tax job" });
    if (!created.ok) throw new Error(created.message);
    const saved = await updateCommercialDetails(db, { id: sales.id, role: sales.role }, { projectId: created.value.id, values: { estimatedValue: "111000000", targetMargin: "10", targetMarginValue: "" } });
    expect(saved.ok).toBe(true);
    const row = async () => (await listProjectsForExport(db, { id: root.id, role: root.role })).find((entry) => entry.code === created.value.code)!;

    // Value with PPN and margin without: 10% is taken of 100,000,000.
    expect((await row()).estimatedGrossProfit).toBe(10_000_000);

    expect(await saveTaxBasis(db, { id: admin.id, role: admin.role }, { valueIncludesTax: false, marginIncludesTax: false, taxRatePercent: 11 })).toMatchObject({ ok: false });
    expect(await saveTaxBasis(db, { id: root.id, role: root.role }, { valueIncludesTax: true, marginIncludesTax: false, taxRatePercent: 99 })).toMatchObject({ ok: false });
    expect(await saveTaxBasis(db, { id: root.id, role: root.role }, { valueIncludesTax: "x", marginIncludesTax: false, taxRatePercent: 11 })).toMatchObject({ ok: false });

    // Both on the same basis: 10% of 111,000,000.
    expect(await saveTaxBasis(db, { id: root.id, role: root.role }, { valueIncludesTax: true, marginIncludesTax: true, taxRatePercent: 11 })).toEqual({ ok: true, changed: true });
    expect((await row()).estimatedGrossProfit).toBe(11_100_000);
    expect(await saveTaxBasis(db, { id: root.id, role: root.role }, { valueIncludesTax: true, marginIncludesTax: true, taxRatePercent: 11 })).toEqual({ ok: true, changed: false });
    await expect(db.auditEvent.findFirst({ where: { action: "settings.tax_basis", actorId: root.id } })).resolves.not.toBeNull();
  });
});
