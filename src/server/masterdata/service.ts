import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { MASTER_KIND_LABELS, MASTER_KINDS, MASTER_NAME_MAX_LENGTH, type MasterKind } from "@/domain/projects/master-data";
import { cleanName, nameKey } from "@/domain/projects/pipeline";
import { notify, projectAudience } from "@/server/notifications/service";

type Actor = { id: string; role: Role };
type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export type MasterRecord = { id: string; name: string; projectCount: number };

export type MasterErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "DUPLICATE" | "IN_USE";
export type MasterResult<T> = { ok: true; value: T } | { ok: false; code: MasterErrorCode; message: string; existing?: { id: string; name: string } };

const fail = (code: MasterErrorCode, message: string, existing?: { id: string; name: string }): MasterResult<never> => ({ ok: false, code, message, ...(existing ? { existing } : {}) });

/** Principal and Solution live in two tables with the same shape; this picks the right one. */
type Named = { id: string; name: string };
type NamedTable = {
  findUnique(args: { where: { id: string } | { nameKey: string }; select: { id?: true; name: true } }): Promise<Named | null>;
  create(args: { data: { name: string; nameKey: string }; select: { id: true; name: true } }): Promise<Named>;
  update(args: { where: { id: string }; data: { name: string; nameKey: string }; select: { id: true; name: true } }): Promise<Named>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

function table(db: Db, kind: MasterKind): NamedTable {
  // The two Prisma delegates have the same shape for what is used here; one narrow type lets the code below call either.
  return (kind === "principal" ? db.principal : db.solutionCategory) as unknown as NamedTable;
}

const nameSchema = z
  .string()
  .transform(cleanName)
  .pipe(z.string().min(1, "Write a name.").max(MASTER_NAME_MAX_LENGTH, `A name can hold at most ${MASTER_NAME_MAX_LENGTH} characters.`))
  .refine((name) => !/[\u0000-\u001F\u007F]/.test(name), "The name contains characters that are not allowed.");

const kindSchema = z.enum(MASTER_KINDS, "Choose Principal or Solution.");

/** The records of one kind with how many projects use each, by name. Anyone who reads projects may read them. */
export async function listMasterRecords(db: PrismaClient, viewer: Actor, kind: MasterKind): Promise<MasterRecord[]> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await (kind === "principal"
    ? db.principal.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { projects: true } } } })
    : db.solutionCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { projects: true } } } }));
  return rows.map((row) => ({ id: row.id, name: row.name, projectCount: row._count.projects }));
}

async function loadActor(tx: Tx, claimed: Actor) {
  const user = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return user?.isActive ? user : null;
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Creates a Principal or a Solution. A name that already exists (ignoring case and spacing) is refused with the existing record,
 * so the caller can select it instead; nothing is created twice, also under concurrency (the unique key decides).
 */
export async function createMasterRecord(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<MasterResult<{ id: string; name: string }>> {
  const parsed = z.object({ kind: kindSchema, name: nameSchema }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "The submitted data is invalid.");
  if (!can(claimedActor.role, "masterdata.manage")) return fail("FORBIDDEN", "You are not allowed to do that.");
  const { kind, name } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<MasterResult<{ id: string; name: string }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "masterdata.manage")) return fail("FORBIDDEN", "You are not allowed to do that.");
      const existing = await table(tx, kind).findUnique({ where: { nameKey: nameKey(name) }, select: { id: true, name: true } });
      if (existing) return fail("DUPLICATE", `${MASTER_KIND_LABELS[kind]} "${existing.name}" already exists.`, existing);

      const created = await table(tx, kind).create({ data: { name, nameKey: nameKey(name) }, select: { id: true, name: true } });
      await tx.auditEvent.create({ data: { actorId: actor.id, action: `${kind}.created`, entityType: kind, entityId: created.id, after: { name: created.name } } });
      return { ok: true, value: created };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await table(db, kind).findUnique({ where: { nameKey: nameKey(name) }, select: { id: true, name: true } });
      if (winner) return fail("DUPLICATE", `${MASTER_KIND_LABELS[kind]} "${winner.name}" already exists.`, winner);
    }
    throw error;
  }
}

/** Renames a record. Its id, and so every project that uses it, stays; the new name must not belong to another record. */
export async function renameMasterRecord(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<MasterResult<{ id: string; name: string }>> {
  const parsed = z.object({ kind: kindSchema, id: z.uuid(), name: nameSchema }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "The submitted data is invalid.");
  if (!can(claimedActor.role, "masterdata.manage")) return fail("FORBIDDEN", "You are not allowed to do that.");
  const { kind, id, name } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<MasterResult<{ id: string; name: string }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "masterdata.manage")) return fail("FORBIDDEN", "You are not allowed to do that.");
      const current = await table(tx, kind).findUnique({ where: { id }, select: { id: true, name: true } });
      if (!current) return fail("NOT_FOUND", `${MASTER_KIND_LABELS[kind]} not found.`);
      const other = await table(tx, kind).findUnique({ where: { nameKey: nameKey(name) }, select: { id: true, name: true } });
      if (other && other.id !== id) return fail("DUPLICATE", `${MASTER_KIND_LABELS[kind]} "${other.name}" already exists.`, other);
      if (current.name === name) return { ok: true, value: current };

      const renamed = await table(tx, kind).update({ where: { id }, data: { name, nameKey: nameKey(name) }, select: { id: true, name: true } });
      await tx.auditEvent.create({ data: { actorId: actor.id, action: `${kind}.renamed`, entityType: kind, entityId: id, before: { name: current.name }, after: { name } } });
      return { ok: true, value: renamed };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("DUPLICATE", `${MASTER_KIND_LABELS[kind]} "${name}" already exists.`);
    throw error;
  }
}

/** Deletes a record that no project uses. One that is in use is refused: move its projects to another record first. */
export async function deleteMasterRecord(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<MasterResult<{ id: string }>> {
  const parsed = z.object({ kind: kindSchema, id: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "The submitted data is invalid.");
  if (!can(claimedActor.role, "masterdata.manage")) return fail("FORBIDDEN", "You are not allowed to do that.");
  const { kind, id } = parsed.data;

  return db.$transaction(async (tx): Promise<MasterResult<{ id: string }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor || !can(actor.role, "masterdata.manage")) return fail("FORBIDDEN", "You are not allowed to do that.");
    const current = await table(tx, kind).findUnique({ where: { id }, select: { id: true, name: true } });
    if (!current) return fail("NOT_FOUND", `${MASTER_KIND_LABELS[kind]} not found.`);
    const used = await tx.project.count({ where: kind === "principal" ? { principalId: id } : { solutionCategoryId: id } });
    if (used > 0) return fail("IN_USE", `${MASTER_KIND_LABELS[kind]} "${current.name}" is used by ${used} project${used === 1 ? "" : "s"}, so it cannot be deleted.`);

    await table(tx, kind).delete({ where: { id } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: `${kind}.deleted`, entityType: kind, entityId: id, before: { name: current.name } } });
    return { ok: true, value: { id } };
  });
}

const idOrBlank = z.union([z.uuid(), z.literal("")]);

/**
 * Sets the Principal and the Solution of a project (SOA's technical work). Only the fields that are sent change; an empty value
 * clears one. Each change is written to the project's change log (from name, to name) and the audit log, in one transaction;
 * nothing else of the project is touched.
 */
export async function setProjectMasterData(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<MasterResult<{ changed: MasterKind[] }>> {
  const parsed = z.object({ projectId: z.uuid(), principalId: idOrBlank.optional(), solutionId: idOrBlank.optional() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Choose a valid Principal and Solution.");
  if (!can(claimedActor.role, "projects.edit.technical")) return fail("FORBIDDEN", "You are not allowed to do that.");
  const { projectId } = parsed.data;

  return db.$transaction(async (tx): Promise<MasterResult<{ changed: MasterKind[] }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor || !can(actor.role, "projects.edit.technical")) return fail("FORBIDDEN", "You are not allowed to do that.");
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { principal: { select: { name: true } }, solutionCategory: { select: { name: true } } },
    });
    if (!project || project.deletedAt) return fail("NOT_FOUND", "Project not found.");

    const data: Prisma.ProjectUncheckedUpdateInput = {};
    const changes: { field: string; from: string | null; to: string | null }[] = [];
    const changed: MasterKind[] = [];
    const slots = [
      { kind: "principal" as const, wanted: parsed.data.principalId, current: project.principalId, currentName: project.principal?.name ?? null, column: "principalId" as const },
      { kind: "solution" as const, wanted: parsed.data.solutionId, current: project.solutionCategoryId, currentName: project.solutionCategory?.name ?? null, column: "solutionCategoryId" as const },
    ];
    for (const slot of slots) {
      if (slot.wanted === undefined) continue;
      const next = slot.wanted === "" ? null : slot.wanted;
      if (next === slot.current) continue;
      let toName: string | null = null;
      if (next !== null) {
        const record = await table(tx, slot.kind).findUnique({ where: { id: next }, select: { id: true, name: true } });
        if (!record) return fail("NOT_FOUND", `${MASTER_KIND_LABELS[slot.kind]} not found. Create it first.`);
        toName = record.name;
      }
      data[slot.column] = next;
      changes.push({ field: slot.kind, from: slot.currentName, to: toName });
      changed.push(slot.kind);
    }
    if (changes.length === 0) return { ok: true, value: { changed: [] } };

    await tx.project.update({ where: { id: project.id }, data });
    const now = new Date();
    await tx.projectChange.createMany({
      data: changes.map((change) => ({ projectId: project.id, changedById: actor.id, field: change.field, fromValue: change.from, toValue: change.to, changedAt: now })),
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "project.master_data_set",
        entityType: "project",
        entityId: project.id,
        before: Object.fromEntries(changes.map((change) => [change.field, change.from])) as Prisma.InputJsonValue,
        after: Object.fromEntries(changes.map((change) => [change.field, change.to])) as Prisma.InputJsonValue,
      },
    });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: await projectAudience(tx, project.id),
      kind: "project.updated",
      title: `${project.code} classification updated`,
      body: `${project.endUserCompany}: ${changes.map((change) => MASTER_KIND_LABELS[change.field as MasterKind]).join(", ")}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, value: { changed } };
  });
}
