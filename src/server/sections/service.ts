import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { PROJECT_EDITABLE_FIELDS } from "@/domain/projects/fields";
import { phaseKeyOf } from "@/domain/requests/phase";
import { setActor } from "@/server/projects/actor-context";
import { notify, projectAudience } from "@/server/notifications/service";

type Actor = { id: string; role: Role };
type Failure = { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT"; message: string };
export type SectionResult<T = Record<string, never>> = { ok: true; value: T } | Failure;

const fail = (code: Failure["code"], message: string): Failure => ({ ok: false, code, message });
const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";

export const SECTION_KINDS = ["TEXT", "CHOICE"] as const;
export const SECTION_LABEL_MAX = 60;
export const SECTION_VALUE_MAX = 4000;

/** Trimmed, single-spaced, lower-cased: the name two sections or two phases cannot share. */
export const labelKeyOf = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
const BUILT_IN_LABEL_KEYS = new Set(Object.values(PROJECT_EDITABLE_FIELDS).map((field) => labelKeyOf(field.label)));

const labelSchema = z.string().trim().min(1, "Tuliskan namanya.").max(SECTION_LABEL_MAX, `Nama maksimal ${SECTION_LABEL_MAX} karakter.`);
/** One option per line (or a list). Blank lines and repeats (ignoring case) are dropped. */
const optionsSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : value.split(/\r?\n/)))
  .transform((list) => {
    const seen = new Set<string>();
    return list.map((item) => item.trim().replace(/\s+/g, " ")).filter((item) => item !== "" && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()));
  })
  .refine((list) => list.every((item) => item.length <= SECTION_LABEL_MAX), `Satu pilihan maksimal ${SECTION_LABEL_MAX} karakter.`);

async function adminActor(tx: Prisma.TransactionClient, claimed: Actor) {
  const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return actor?.isActive && can(actor.role, "sections.manage") ? actor : null;
}

async function audit(tx: Prisma.TransactionClient, actorId: string, action: string, entityId: string, before: unknown, after: unknown) {
  await tx.auditEvent.create({
    data: { actorId, action, entityType: "technical_section", entityId, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue },
  });
}

/** Adds a technical section: a name, and either free text or one of a list of choices. Admin and Superadmin. */
export async function createSection(db: PrismaClient, claimed: Actor, input: unknown): Promise<SectionResult<{ id: string }>> {
  const parsed = z
    .object({ label: labelSchema, kind: z.enum(SECTION_KINDS, "Pilih bentuk isiannya."), options: optionsSchema.optional() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimed.role, "sections.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { label, kind } = parsed.data;
  const options = kind === "CHOICE" ? (parsed.data.options ?? []) : [];
  if (kind === "CHOICE" && options.length < 2) return fail("INVALID_INPUT", "Isian pilihan butuh minimal dua pilihan.");
  const labelKey = labelKeyOf(label);
  if (BUILT_IN_LABEL_KEYS.has(labelKey)) return fail("CONFLICT", `"${label}" sudah ada sebagai bagian bawaan.`);

  return db.$transaction(async (tx): Promise<SectionResult<{ id: string }>> => {
    const actor = await adminActor(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    if (await tx.technicalSection.findUnique({ where: { labelKey }, select: { id: true } })) return fail("CONFLICT", `Bagian "${label}" sudah ada.`);
    const last = await tx.technicalSection.aggregate({ _max: { position: true } });
    const section = await tx.technicalSection.create({ data: { label, labelKey, kind, options, position: (last._max.position ?? 0) + 10 } });
    await audit(tx, actor.id, "section.created", section.id, null, { label, kind, options });
    return { ok: true, value: { id: section.id } };
  });
}

/** Renames a section, replaces its list of choices, or switches it on or off. The kind stays; values already saved are kept as they are. */
export async function updateSection(db: PrismaClient, claimed: Actor, input: unknown): Promise<SectionResult> {
  const parsed = z.object({ id: z.uuid(), label: labelSchema.optional(), options: optionsSchema.optional(), isActive: z.boolean().optional() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimed.role, "sections.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { id, label, options, isActive } = parsed.data;

  return db.$transaction(async (tx): Promise<SectionResult> => {
    const actor = await adminActor(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    const section = await tx.technicalSection.findUnique({ where: { id } });
    if (!section) return fail("NOT_FOUND", "Bagian tidak ditemukan.");
    const data: Prisma.TechnicalSectionUpdateInput = {};
    if (label !== undefined && label !== section.label) {
      const labelKey = labelKeyOf(label);
      if (BUILT_IN_LABEL_KEYS.has(labelKey)) return fail("CONFLICT", `"${label}" sudah ada sebagai bagian bawaan.`);
      const clash = await tx.technicalSection.findUnique({ where: { labelKey }, select: { id: true } });
      if (clash && clash.id !== id) return fail("CONFLICT", `Bagian "${label}" sudah ada.`);
      Object.assign(data, { label, labelKey });
    }
    if (options !== undefined) {
      if (section.kind !== "CHOICE") return fail("INVALID_INPUT", "Hanya isian pilihan yang punya daftar pilihan.");
      if (options.length < 2) return fail("INVALID_INPUT", "Isian pilihan butuh minimal dua pilihan.");
      data.options = options;
    }
    if (isActive !== undefined) data.isActive = isActive;
    if (Object.keys(data).length === 0) return { ok: true, value: {} };
    await tx.technicalSection.update({ where: { id }, data });
    await audit(
      tx,
      actor.id,
      "section.updated",
      id,
      { label: section.label, options: section.options, isActive: section.isActive },
      { label: label ?? section.label, options: options ?? section.options, isActive: isActive ?? section.isActive },
    );
    return { ok: true, value: {} };
  });
}

/** Adds an SOA phase ("Pre Assessment"). The key is made from the name and stays when the name is changed. */
export async function createPhase(db: PrismaClient, claimed: Actor, input: unknown): Promise<SectionResult<{ key: string }>> {
  const parsed = z.object({ label: labelSchema }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimed.role, "sections.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { label } = parsed.data;
  const key = phaseKeyOf(label);
  if (key === "") return fail("INVALID_INPUT", "Nama phase harus memuat huruf atau angka.");

  return db.$transaction(async (tx): Promise<SectionResult<{ key: string }>> => {
    const actor = await adminActor(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    if (await tx.soaPhaseOption.findFirst({ where: { OR: [{ key }, { labelKey: labelKeyOf(label) }] }, select: { key: true } })) {
      return fail("CONFLICT", `Phase "${label}" sudah ada.`);
    }
    const last = await tx.soaPhaseOption.aggregate({ _max: { position: true } });
    await tx.soaPhaseOption.create({ data: { key, label, labelKey: labelKeyOf(label), position: (last._max.position ?? 0) + 10 } });
    await audit(tx, actor.id, "soa_phase.created", key, null, { label });
    return { ok: true, value: { key } };
  });
}

/** Renames an SOA phase or switches it off (a request that holds it keeps it; it is just not offered again). */
export async function updatePhase(db: PrismaClient, claimed: Actor, input: unknown): Promise<SectionResult> {
  const parsed = z.object({ key: z.string().min(1).max(40), label: labelSchema.optional(), isActive: z.boolean().optional() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimed.role, "sections.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { key, label, isActive } = parsed.data;

  return db.$transaction(async (tx): Promise<SectionResult> => {
    const actor = await adminActor(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    const phase = await tx.soaPhaseOption.findUnique({ where: { key } });
    if (!phase) return fail("NOT_FOUND", "Phase tidak ditemukan.");
    const data: Prisma.SoaPhaseOptionUpdateInput = {};
    if (label !== undefined && label !== phase.label) {
      const clash = await tx.soaPhaseOption.findUnique({ where: { labelKey: labelKeyOf(label) }, select: { key: true } });
      if (clash && clash.key !== key) return fail("CONFLICT", `Phase "${label}" sudah ada.`);
      Object.assign(data, { label, labelKey: labelKeyOf(label) });
    }
    if (isActive !== undefined) data.isActive = isActive;
    if (Object.keys(data).length === 0) return { ok: true, value: {} };
    await tx.soaPhaseOption.update({ where: { key }, data });
    await audit(tx, actor.id, "soa_phase.updated", key, { label: phase.label, isActive: phase.isActive }, { label: label ?? phase.label, isActive: isActive ?? phase.isActive });
    return { ok: true, value: {} };
  });
}

/** Saves what SOA wrote in the added sections of one project: one change-log row per changed section, one audit event. */
export async function setSectionValues(db: PrismaClient, claimed: Actor, input: unknown): Promise<SectionResult<{ changed: string[] }>> {
  const parsed = z.object({ projectId: z.uuid(), values: z.record(z.uuid(), z.string()) }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Data yang dikirim tidak valid.");
  if (!can(claimed.role, "projects.edit.technical")) return fail("FORBIDDEN", FORBIDDEN);
  const { projectId, values } = parsed.data;

  return db.$transaction(async (tx): Promise<SectionResult<{ changed: string[] }>> => {
    const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.edit.technical")) return fail("FORBIDDEN", FORBIDDEN);
    await setActor(tx, actor.id);
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, endUserCompany: true, deletedAt: true } });
    if (!project || project.deletedAt) return fail("NOT_FOUND", "Project tidak ditemukan.");

    const sections = await tx.technicalSection.findMany({ where: { id: { in: Object.keys(values) } } });
    if (sections.length !== Object.keys(values).length) return fail("INVALID_INPUT", "Ada bagian yang tidak dikenal.");
    const stored = new Map((await tx.projectSectionValue.findMany({ where: { projectId } })).map((row) => [row.sectionId, row.value]));
    const changes: { sectionId: string; label: string; from: string | null; to: string | null }[] = [];
    for (const section of sections) {
      const to = (values[section.id] ?? "").trim() || null;
      const from = stored.get(section.id) ?? null;
      if (to === from) continue;
      if (!section.isActive && to !== null) return fail("INVALID_INPUT", `Bagian "${section.label}" sedang tidak dipakai.`);
      if (to !== null && to.length > SECTION_VALUE_MAX) return fail("INVALID_INPUT", `"${section.label}" maksimal ${SECTION_VALUE_MAX} karakter.`);
      // A choice must be one of the list; a value already saved may stay even if it was taken off the list (it is then simply not changed).
      if (to !== null && section.kind === "CHOICE" && !section.options.includes(to)) return fail("INVALID_INPUT", `Pilih salah satu pilihan untuk "${section.label}".`);
      changes.push({ sectionId: section.id, label: section.label, from, to });
    }
    if (changes.length === 0) return { ok: true, value: { changed: [] } };

    for (const change of changes) {
      const key = { projectId_sectionId: { projectId, sectionId: change.sectionId } };
      if (change.to === null) await tx.projectSectionValue.delete({ where: key });
      else await tx.projectSectionValue.upsert({ where: key, create: { projectId, sectionId: change.sectionId, value: change.to }, update: { value: change.to } });
    }
    const now = new Date();
    const logged = (pick: (change: (typeof changes)[number]) => string | null) => Object.fromEntries(changes.map((change) => [`custom:${change.label}`, pick(change)])) as Prisma.InputJsonValue;
    await tx.projectChange.createMany({ data: changes.map((change) => ({ projectId, changedById: actor.id, field: `custom:${change.label}`, fromValue: change.from, toValue: change.to, changedAt: now })) });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "project.details_updated", entityType: "project", entityId: projectId, before: logged((c) => c.from), after: logged((c) => c.to) } });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: await projectAudience(tx, projectId),
      kind: "project.updated",
      title: `${project.code} technical details updated`,
      body: `${project.endUserCompany}: ${changes.map((change) => change.label).join(", ")}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, value: { changed: changes.map((change) => change.label) } };
  });
}

export async function listSections(db: PrismaClient, viewer: Actor, options: { includeInactive?: boolean } = {}) {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  return db.technicalSection.findMany({ where: options.includeInactive ? {} : { isActive: true }, orderBy: [{ position: "asc" }, { label: "asc" }] });
}

/** What each added section holds on one project (sections that were switched off still show what they held). */
export async function listSectionValues(db: PrismaClient, viewer: Actor, projectId: string) {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.projectSectionValue.findMany({ where: { projectId }, include: { section: true }, orderBy: { section: { position: "asc" } } });
  return rows.map((row) => ({ sectionId: row.sectionId, label: row.section.label, value: row.value }));
}
