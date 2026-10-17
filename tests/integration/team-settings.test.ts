import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { DEFAULT_TEMPLATES } from "@/domain/requests/template";
import { getTeamSetting, saveTeamSetting } from "@/server/settings/team-settings";
import { makeUser } from "./helpers";

const db = getDb();

// The settings are global and the end-to-end tests read them from the same database, so every test leaves the defaults behind.
afterAll(async () => {
  await db.teamSetting.deleteMany();
  await db.$disconnect();
});

const actor = (user: { id: string; role: Parameters<typeof saveTeamSetting>[1]["role"] }) => ({ id: user.id, role: user.role });
const valid = { role: "SOA", sla: "2-3", emailSubject: "[{{request_id}}] {{project_name}}", emailBody: "Hi {{team}}, please answer {{request_id}} by {{due_date}}." };

describe("saveTeamSetting", () => {
  it("lets the superadmin set the SLA and the template, audits it, and can restore the defaults", async () => {
    const root = await makeUser("SUPERADMIN");

    expect(await saveTeamSetting(db, actor(root), valid)).toEqual({ ok: true, changed: true });
    expect(await getTeamSetting(db, "SOA")).toMatchObject({ sla: { minDays: 2, maxDays: 3 }, emailSubject: valid.emailSubject, emailBody: valid.emailBody, isDefault: false });
    expect(await saveTeamSetting(db, actor(root), valid)).toEqual({ ok: true, changed: false });
    await expect(db.auditEvent.count({ where: { action: "team_settings.saved", entityId: "SOA", actorId: root.id } })).resolves.toBe(1);

    expect(await saveTeamSetting(db, actor(root), { ...valid, restoreDefaults: true })).toEqual({ ok: true, changed: true });
    expect(await getTeamSetting(db, "SOA")).toMatchObject({ sla: { minDays: 2, maxDays: 3 }, emailSubject: DEFAULT_TEMPLATES.SOA.subject, emailBody: DEFAULT_TEMPLATES.SOA.body });
  });

  it("takes the SLA as one number or a range, and refuses anything else or more than 7 days", async () => {
    const root = await makeUser("SUPERADMIN");

    expect(await saveTeamSetting(db, actor(root), { ...valid, sla: "1-4" })).toEqual({ ok: true, changed: true });
    expect((await getTeamSetting(db, "SOA")).sla).toEqual({ minDays: 1, maxDays: 4 });
    expect(await saveTeamSetting(db, actor(root), { ...valid, sla: "5" })).toEqual({ ok: true, changed: true });
    expect((await getTeamSetting(db, "SOA")).sla).toEqual({ minDays: 5, maxDays: 5 });
    expect(await saveTeamSetting(db, actor(root), { ...valid, sla: "7 hari" })).toMatchObject({ ok: true });
    for (const sla of ["8", "1-8", "3-2", "0", "", "abc", "2-3-4"]) {
      expect(await saveTeamSetting(db, actor(root), { ...valid, sla }), sla).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    expect((await getTeamSetting(db, "SOA")).sla).toEqual({ minDays: 7, maxDays: 7 });
  });

  it("keeps each team's settings apart, and Purchasing starts on the defaults", async () => {
    const root = await makeUser("SUPERADMIN");
    await saveTeamSetting(db, actor(root), { ...valid, sla: "1" });
    await saveTeamSetting(db, actor(root), { ...valid, role: "PURCHASING", sla: "3", emailBody: "Purchasing: {{request_id}}" });

    expect((await getTeamSetting(db, "SOA")).sla).toEqual({ minDays: 1, maxDays: 1 });
    expect(await getTeamSetting(db, "PURCHASING")).toMatchObject({ sla: { minDays: 3, maxDays: 3 }, emailBody: "Purchasing: {{request_id}}" });
  });

  it("refuses everyone but the superadmin, an SLA outside 1 to 3 days, and a bad template", async () => {
    const root = await makeUser("SUPERADMIN");
    for (const role of ["ADMIN", "SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      const user = await makeUser(role);
      expect(await saveTeamSetting(db, actor(user), valid)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(await saveTeamSetting(db, actor(root), { ...valid, emailSubject: "No id here" })).toMatchObject({ ok: false, message: expect.stringContaining("{{request_id}}") });
    expect(await saveTeamSetting(db, actor(root), { ...valid, emailBody: "Hello {{nobody}}" })).toMatchObject({ ok: false, message: expect.stringContaining("{{nobody}}") });
    expect(await saveTeamSetting(db, actor(root), { ...valid, role: "SALES" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("the database refuses a role other than SOA or Purchasing and an SLA outside 1 to 7 days or running backwards", async () => {
    const data = { slaMinDays: 2, slaDays: 3, emailSubject: "s", emailBody: "b" };
    await expect(db.teamSetting.create({ data: { role: "SOA", ...data, slaMinDays: 4 } })).rejects.toThrow(/team_settings_sla_range_chk/);
    await expect(db.teamSetting.create({ data: { role: "SALES", ...data } })).rejects.toThrow(/team_settings_role_chk/);
    await expect(db.teamSetting.upsert({ where: { role: "SOA" }, create: { role: "SOA", ...data }, update: { slaDays: 8 } })).rejects.toThrow(/team_settings_sla_range_chk/);
  });
});
