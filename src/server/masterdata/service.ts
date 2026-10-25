import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { MASTER_KIND_LABELS, MASTER_KINDS, MASTER_NAME_MAX_LENGTH, MAX_PROJECT_PRINCIPALS, principalNamesOf, type MasterKind } from "@/domain/projects/master-data";
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
    ? db.principal.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { projectLinks: true } } } }).then((found) => found.map((row) => ({ id: row.id, name: row.name, count: row._count.projectLinks })))
    : db.solutionCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { projects: true } } } }).then((found) => found.map((row) => ({ id: row.id, name: row.name, count: row._count.projects }))));
  return rows.map((row) => ({ id: row.id, name: row.name, projectCount: row.count }));
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
  if (!can(claimedActor.role, "masterdata.manage")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
  const { kind, name } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<MasterResult<{ id: string; name: string }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "masterdata.manage")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
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
  if (!can(claimedActor.role, "masterdata.manage")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
  const { kind, id, name } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<MasterResult<{ id: string; name: string }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "masterdata.manage")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
      const current = await table(tx, kind).findUnique({ where: { id }, select: { id: true, name: true } });
      if (!current) return fail("NOT_FOUND", `${MASTER_KIND_LABELS[kind]} tidak ditemukan.`);
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
  if (!can(claimedActor.role, "masterdata.manage")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
  const { kind, id } = parsed.data;

  return db.$transaction(async (tx): Promise<MasterResult<{ id: string }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor || !can(actor.role, "masterdata.manage")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
    const current = await table(tx, kind).findUnique({ where: { id }, select: { id: true, name: true } });
    if (!current) return fail("NOT_FOUND", `${MASTER_KIND_LABELS[kind]} tidak ditemukan.`);
    // A project is linked to a principal through its link row (and the first one also sits in principal_id).
    const used = kind === "principal" ? await tx.project.count({ where: { OR: [{ principals: { some: { principalId: id } } }, { principalId: id }] } }) : await tx.project.count({ where: { solutionCategoryId: id } });
    if (used > 0) return fail("IN_USE", `${MASTER_KIND_LABELS[kind]} "${current.name}" is used by ${used} project${used === 1 ? "" : "s"}, so it cannot be deleted.`);

    await table(tx, kind).delete({ where: { id } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: `${kind}.deleted`, entityType: kind, entityId: id, before: { name: current.name } } });
    return { ok: true, value: { id } };
  });
}

const idOrBlank = z.union([z.uuid(), z.literal("")]);

const principalIdsSchema = z.array(z.uuid()).max(MAX_PROJECT_PRINCIPALS, `A project can have at most ${MAX_PROJECT_PRINCIPALS} principals.`);

/**
 * Sets the Principals and the Solution of a project (SOA's technical work). A project can be built on several principals: send
 * `principalIds` (the whole list, in order; an empty list clears it). `principalId` is the single-principal form of the same thing.
 * Only the fields that are sent change. The same principal twice is one link. The first principal is also kept in
 * `projects.principal_id`. Each change is written to the project's change log (from names, to names) and the audit log, in one
 * transaction; nothing else of the project is touched.
 */
export async function setProjectMasterData(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<MasterResult<{ changed: MasterKind[] }>> {
  const parsed = z
    .object({ projectId: z.uuid(), principalId: idOrBlank.optional(), principalIds: principalIdsSchema.optional(), solutionId: idOrBlank.optional() })
    .strict()
    .refine((value) => value.principalId === undefined || value.principalIds === undefined, "Send either principalId or principalIds.")
    .safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Choose a valid Principal and Solution.");
  if (!can(claimedActor.role, "projects.edit.technical")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
  const { projectId } = parsed.data;
  // The wanted principals, once each, in the order given; undefined when the caller did not send any.
  const wantedPrincipals: string[] | undefined =
    parsed.data.principalIds !== undefined ? [...new Set(parsed.data.principalIds)] : parsed.data.principalId === undefined ? undefined : parsed.data.principalId === "" ? [] : [parsed.data.principalId];

  return db.$transaction(async (tx): Promise<MasterResult<{ changed: MasterKind[] }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor || !can(actor.role, "projects.edit.technical")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        principal: { select: { name: true } },
        principals: { orderBy: { position: "asc" }, select: { principalId: true, principal: { select: { name: true } } } },
        solutionCategory: { select: { name: true } },
      },
    });
    if (!project || project.deletedAt) return fail("NOT_FOUND", "Project tidak ditemukan.");

    const data: Prisma.ProjectUncheckedUpdateInput = {};
    const changes: { field: string; from: string | null; to: string | null }[] = [];
    const changed: MasterKind[] = [];

    if (wantedPrincipals !== undefined) {
      const currentIds = project.principals.length > 0 ? project.principals.map((link) => link.principalId) : project.principalId ? [project.principalId] : [];
      const sameList = wantedPrincipals.length === currentIds.length && wantedPrincipals.every((id, index) => id === currentIds[index]);
      if (!sameList) {
        const records = await tx.principal.findMany({ where: { id: { in: wantedPrincipals } }, select: { id: true, name: true } });
        if (records.length !== wantedPrincipals.length) return fail("NOT_FOUND", `${MASTER_KIND_LABELS.principal} tidak ditemukan. Buat dulu datanya.`);
        const nameOf = new Map(records.map((record) => [record.id, record.name]));
        // Links that stay keep their row; removed ones go; new ones are added; positions follow the order given.
        await tx.projectPrincipal.deleteMany({ where: { projectId: project.id, principalId: { notIn: wantedPrincipals } } });
        for (const [position, principalId] of wantedPrincipals.entries()) {
          await tx.projectPrincipal.upsert({
            where: { projectId_principalId: { projectId: project.id, principalId } },
            update: { position },
            create: { projectId: project.id, principalId, position },
          });
        }
        data.principalId = wantedPrincipals[0] ?? null;
        changes.push({
          field: "principal",
          from: principalNamesOf(project).join(", ") || null,
          to: wantedPrincipals.map((id) => nameOf.get(id)!).join(", ") || null,
        });
        changed.push("principal");
      }
    }

    if (parsed.data.solutionId !== undefined) {
      const next = parsed.data.solutionId === "" ? null : parsed.data.solutionId;
      if (next !== project.solutionCategoryId) {
        let toName: string | null = null;
        if (next !== null) {
          const record = await tx.solutionCategory.findUnique({ where: { id: next }, select: { id: true, name: true } });
          if (!record) return fail("NOT_FOUND", `${MASTER_KIND_LABELS.solution} tidak ditemukan. Buat dulu datanya.`);
          toName = record.name;
        }
        data.solutionCategoryId = next;
        changes.push({ field: "solution", from: project.solutionCategory?.name ?? null, to: toName });
        changed.push("solution");
      }
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
