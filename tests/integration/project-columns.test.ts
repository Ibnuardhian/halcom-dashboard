import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { DEFAULT_PROJECT_COLUMNS } from "@/domain/projects/table-columns";
import { getProjectColumns, saveProjectColumns } from "@/server/settings/app-settings";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: "projects.columns" } });
  await db.$disconnect();
});

describe("the columns of the Projects table", () => {
  it("are set by a Superadmin for everyone, audited, and read back in the table's order", async () => {
    const root = await makeUser("SUPERADMIN");
    await db.appSetting.deleteMany({ where: { key: "projects.columns" } });
    expect(await getProjectColumns(db)).toEqual([...DEFAULT_PROJECT_COLUMNS]);

    expect(await saveProjectColumns(db, root, ["status", "endUser", "nonsense"])).toEqual({ ok: true, changed: true });
    expect(await getProjectColumns(db)).toEqual(["endUser", "status"]);
    expect(await saveProjectColumns(db, root, ["endUser", "status"])).toEqual({ ok: true, changed: false });
    await expect(db.auditEvent.findFirst({ where: { action: "settings.project_columns", actorId: root.id } })).resolves.toMatchObject({ after: { columns: ["endUser", "status"] } });
  });

  it("are refused to anyone but a Superadmin, and an empty choice is refused", async () => {
    const [admin, root] = await Promise.all([makeUser("ADMIN"), makeUser("SUPERADMIN")]);
    expect(await saveProjectColumns(db, admin, ["name"])).toMatchObject({ ok: false });
    expect(await saveProjectColumns(db, root, [])).toMatchObject({ ok: false });
    expect(await saveProjectColumns(db, root, "name")).toMatchObject({ ok: false });
  });
});
