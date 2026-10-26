import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { createPhase, createSection, listSectionValues, setSectionValues, updatePhase, updateSection } from "@/server/sections/service";
import { createRequest, createProject, setRequestPhase } from "@/server/requests/service";
import { listProjectChanges } from "@/server/projects/queries";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

const unique = (base: string) => `${base} ${randomBytes(3).toString("hex")}`;

describe("technical sections", () => {
  it("lets an Admin and a Superadmin add a text and a choice section, and refuses the other roles, duplicates and built-in names", async () => {
    const [admin, root, soa, sales] = await Promise.all([actorOf("ADMIN"), actorOf("SUPERADMIN"), actorOf("SOA"), actorOf("SALES")]);
    const label = unique("Pre Assessment");

    expect((await createSection(db, admin, { label, kind: "TEXT" })).ok).toBe(true);
    expect((await createSection(db, root, { label: unique("Site survey"), kind: "CHOICE", options: "Planned\nDone\nplanned\n" })).ok).toBe(true);
    for (const actor of [soa, sales]) expect(await createSection(db, actor, { label: unique("X"), kind: "TEXT" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await createSection(db, admin, { label: `  ${label.toUpperCase()}  `, kind: "TEXT" })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await createSection(db, admin, { label: "sizing", kind: "TEXT" })).toMatchObject({ ok: false, code: "CONFLICT" }); // a built-in section
    expect(await createSection(db, admin, { label: unique("One option"), kind: "CHOICE", options: "Only one" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createSection(db, admin, { label: unique("Bad kind"), kind: "NUMBER" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("lets SOA fill an added section with a change log, keeps the old value when the choice list changes, and refuses values outside the list", async () => {
    const [admin, soa, sales] = await Promise.all([actorOf("ADMIN"), actorOf("SOA"), actorOf("SALES")]);
    const created = await createProject(db, sales, { endUserCompany: unique("PT Sec"), name: "sections" });
    if (!created.ok) throw new Error(created.message);
    const projectId = created.value.id;
    const text = await createSection(db, admin, { label: unique("Notes A"), kind: "TEXT" });
    const choice = await createSection(db, admin, { label: unique("Status B"), kind: "CHOICE", options: ["Planned", "Done"] });
    if (!text.ok || !choice.ok) throw new Error("setup");

    expect(await setSectionValues(db, sales, { projectId, values: { [text.value.id]: "x" } })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setSectionValues(db, soa, { projectId, values: { [choice.value.id]: "Invented" } })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const saved = await setSectionValues(db, soa, { projectId, values: { [text.value.id]: "  Form sent  ", [choice.value.id]: "Planned" } });
    expect(saved.ok && saved.value.changed).toHaveLength(2);
    expect((await listSectionValues(db, soa, projectId)).map((row) => row.value).sort()).toEqual(["Form sent", "Planned"]);
    // Saving the same values again writes nothing.
    expect(await setSectionValues(db, soa, { projectId, values: { [text.value.id]: "Form sent" } })).toMatchObject({ ok: true, value: { changed: [] } });
    const log = await listProjectChanges(db, soa, projectId);
    expect(log.map((row) => row.field).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/^custom:Notes A/), expect.stringMatching(/^custom:Status B/)]));

    // The list of choices grows: the old value stays; taking the section off blocks new values but keeps what was saved.
    expect((await updateSection(db, admin, { id: choice.value.id, options: ["Planned", "Done", "Pre check"] })).ok).toBe(true);
    expect((await setSectionValues(db, soa, { projectId, values: { [choice.value.id]: "Pre check" } })).ok).toBe(true);
    expect((await updateSection(db, admin, { id: choice.value.id, isActive: false })).ok).toBe(true);
    expect(await setSectionValues(db, soa, { projectId, values: { [choice.value.id]: "Done" } })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await listSectionValues(db, soa, projectId)).some((row) => row.value === "Pre check")).toBe(true);
    // Clearing a value removes it.
    expect((await setSectionValues(db, soa, { projectId, values: { [text.value.id]: "" } })).ok).toBe(true);
    expect((await listSectionValues(db, soa, projectId)).some((row) => row.sectionId === text.value.id)).toBe(false);
  });
});

describe("SOA phases", () => {
  it("lets an Admin add a phase that SOA can then pick, refuses an unknown or switched-off one, and keeps a request on a phase that was switched off", async () => {
    const [admin, soa, sales, other] = await Promise.all([actorOf("ADMIN"), actorOf("SOA"), actorOf("SALES"), actorOf("SALES")]);
    const label = unique("Pre Assessment");
    const created = await createPhase(db, admin, { label });
    if (!created.ok) throw new Error(created.message);
    expect(await createPhase(db, admin, { label: label.toLowerCase() })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await createPhase(db, sales, { label: unique("Nope") })).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const project = await createProject(db, sales, { endUserCompany: unique("PT Phase"), name: "phase" });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, sales, { projectId: project.value.id, type: "BOQ", title: "phase test" });
    if (!boq.ok) throw new Error(boq.message);

    expect(await setRequestPhase(db, soa, { requestId: boq.value.id, phase: created.value.key })).toMatchObject({ ok: true });
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.value.id } })).resolves.toMatchObject({ phase: created.value.key });
    expect(await setRequestPhase(db, soa, { requestId: boq.value.id, phase: "NOT_A_PHASE" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    expect((await updatePhase(db, admin, { key: created.value.key, isActive: false })).ok).toBe(true);
    const second = await createRequest(db, other, { projectId: (await createProject(db, other, { endUserCompany: unique("PT Phase2"), name: "p2" }) as { ok: true; value: { id: string } }).value.id, type: "BOQ", title: "second" });
    if (!second.ok) throw new Error(second.message);
    expect(await setRequestPhase(db, soa, { requestId: second.value.id, phase: created.value.key })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    // The first request still holds the switched-off phase.
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.value.id } })).resolves.toMatchObject({ phase: created.value.key });
  });
});
