import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { cleanName, nameKey } from "@/domain/projects/pipeline";
import { PIC_NAME_MAX_LENGTH, PIC_TEAM_LABELS, PIC_TEAMS, picTeamOf, type PicOption, type PicTeam } from "@/domain/pics/teams";
import { workPermission } from "@/domain/requests/access";
import type { RequestType } from "@/domain/requests/types";

type Actor = { id: string; role: Role };
type Tx = Prisma.TransactionClient;

export type PicErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "DUPLICATE";
export type PicResult<T> = { ok: true; value: T } | { ok: false; code: PicErrorCode; message: string; existing?: { id: string; name: string } };

const fail = (code: PicErrorCode, message: string, existing?: { id: string; name: string }): PicResult<never> => ({ ok: false, code, message, ...(existing ? { existing } : {}) });
const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";

const nameSchema = z
  .string()
  .transform(cleanName)
  .pipe(z.string().min(1, "Tulis nama.").max(PIC_NAME_MAX_LENGTH, `Nama maksimal ${PIC_NAME_MAX_LENGTH} karakter.`))
  .refine((name) => !/[\u0000-\u001F\u007F]/.test(name), "The name contains characters that are not allowed.");

async function loadActor(tx: Tx, claimed: Actor) {
  const user = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return user?.isActive ? user : null;
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export type PicRecord = { id: string; team: PicTeam; name: string; isActive: boolean; openRequests: number; totalRequests: number };

/** Every PIC of both teams, active first, with how many requests each one holds. For the administrator who keeps the list. */
export async function listPics(db: PrismaClient, viewer: Actor): Promise<PicRecord[]> {
  if (!can(viewer.role, "pics.manage")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.pic.findMany({
    orderBy: [{ team: "asc" }, { isActive: "desc" }, { name: "asc" }],
    select: { id: true, team: true, name: true, isActive: true, requests: { select: { status: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    team: row.team,
    name: row.name,
    isActive: row.isActive,
    openRequests: row.requests.filter((request) => request.status !== "COMPLETED" && request.status !== "CANCELLED").length,
    totalRequests: row.requests.length,
  }));
}

/** The active PICs a request of this type can be handed to (SOA's for a BOQ, Purchasing's for an RFQ or PO). For the people who work that type. */
export async function listAssignablePics(db: PrismaClient, viewer: Actor, type: RequestType): Promise<PicOption[]> {
  if (!can(viewer.role, workPermission(type))) throw new Error("Forbidden: missing permission for this query.");
  return db.pic.findMany({ where: { team: picTeamOf(type), isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** Creates a PIC. A name the team already has (ignoring case and spacing) is refused with the existing record. */
export async function createPic(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PicResult<{ id: string; name: string }>> {
  const parsed = z.object({ team: z.enum(PIC_TEAMS, "Pilih SOA atau Purchasing."), name: nameSchema }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimedActor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { team, name } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<PicResult<{ id: string; name: string }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
      const existing = await tx.pic.findUnique({ where: { team_nameKey: { team, nameKey: nameKey(name) } }, select: { id: true, name: true } });
      if (existing) return fail("DUPLICATE", `${PIC_TEAM_LABELS[team]} already has a PIC named "${existing.name}".`, existing);
      const created = await tx.pic.create({ data: { team, name, nameKey: nameKey(name) }, select: { id: true, name: true } });
      await tx.auditEvent.create({ data: { actorId: actor.id, action: "pic.created", entityType: "pic", entityId: created.id, after: { team, name } } });
      return { ok: true, value: created };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.pic.findUnique({ where: { team_nameKey: { team, nameKey: nameKey(name) } }, select: { id: true, name: true } });
      if (winner) return fail("DUPLICATE", `${PIC_TEAM_LABELS[team]} already has a PIC named "${winner.name}".`, winner);
    }
    throw error;
  }
}

/**
 * Renames a PIC and/or turns it on or off. A PIC is never deleted: requests it held and the assignment history keep pointing at it,
 * so the name stays readable. Deactivating only stops new assignments; what it already holds stays until someone reassigns it.
 */
export async function updatePic(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PicResult<{ id: string; name: string; isActive: boolean }>> {
  const parsed = z.object({ id: z.uuid(), name: nameSchema.optional(), isActive: z.boolean().optional() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimedActor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { id, name, isActive } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<PicResult<{ id: string; name: string; isActive: boolean }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
      const current = await tx.pic.findUnique({ where: { id } });
      if (!current) return fail("NOT_FOUND", "PIC tidak ditemukan.");
      if (name !== undefined && name !== current.name) {
        const other = await tx.pic.findUnique({ where: { team_nameKey: { team: current.team, nameKey: nameKey(name) } }, select: { id: true, name: true } });
        if (other && other.id !== id) return fail("DUPLICATE", `${PIC_TEAM_LABELS[current.team]} already has a PIC named "${other.name}".`, other);
      }
      const data: Prisma.PicUpdateInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (name !== undefined && name !== current.name) {
        data.name = name;
        data.nameKey = nameKey(name);
        before["name"] = current.name;
        after["name"] = name;
      }
      if (isActive !== undefined && isActive !== current.isActive) {
        data.isActive = isActive;
        before["isActive"] = current.isActive;
        after["isActive"] = isActive;
      }
      if (Object.keys(after).length === 0) return { ok: true, value: { id: current.id, name: current.name, isActive: current.isActive } };

      const updated = await tx.pic.update({ where: { id }, data });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "isActive" in after && !("name" in after) ? (isActive ? "pic.activated" : "pic.deactivated") : "pic.updated",
          entityType: "pic",
          entityId: id,
          before: before as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
        },
      });
      return { ok: true, value: { id: updated.id, name: updated.name, isActive: updated.isActive } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("DUPLICATE", `${PIC_TEAM_LABELS[(await db.pic.findUnique({ where: { id }, select: { team: true } }))?.team ?? "SOA"]} already has a PIC with that name.`);
    throw error;
  }
}

/**
 * Hands a request to a PIC of the team that works its type (or takes it back with an empty `picId`). Only people who work that
 * type may do it. The earlier PIC stays in the assignment history, and the change is audited, in the same transaction.
 */
export async function assignRequestPic(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PicResult<{ code: string; picId: string | null }>> {
  const parsed = z.object({ requestId: z.uuid(), picId: z.union([z.uuid(), z.literal("")]) }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Pilih PIC yang valid.");
  const { requestId } = parsed.data;
  const wanted = parsed.data.picId === "" ? null : parsed.data.picId;

  return db.$transaction(async (tx): Promise<PicResult<{ code: string; picId: string | null }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({ where: { id: requestId }, include: { project: { select: { deletedAt: true } }, pic: { select: { name: true } } } });
    if (!request || request.project.deletedAt) return fail("NOT_FOUND", "Request tidak ditemukan.");
    if (!can(actor.role, workPermission(request.type))) return fail("FORBIDDEN", FORBIDDEN);
    if (wanted === request.picId) return { ok: true, value: { code: request.code, picId: request.picId } };

    let toName: string | null = null;
    if (wanted !== null) {
      const pic = await tx.pic.findUnique({ where: { id: wanted }, select: { id: true, name: true, team: true, isActive: true } });
      if (!pic) return fail("NOT_FOUND", "PIC tidak ditemukan.");
      if (pic.team !== picTeamOf(request.type)) return fail("INVALID_INPUT", `A ${request.type} request goes to a ${PIC_TEAM_LABELS[picTeamOf(request.type)]} PIC.`);
      if (!pic.isActive) return fail("INVALID_INPUT", `${pic.name} is not active, so nothing can be assigned to them.`);
      toName = pic.name;
    }
    await tx.request.update({ where: { id: request.id }, data: { picId: wanted } });
    await tx.requestPicAssignment.create({ data: { requestId: request.id, fromPicId: request.picId, toPicId: wanted, changedById: actor.id } });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: "request.pic_assigned", entityType: "request", entityId: request.id, before: { pic: request.pic?.name ?? null }, after: { pic: toName } },
    });
    return { ok: true, value: { code: request.code, picId: wanted } };
  });
}

export type PicAssignmentRow = { id: string; fromName: string | null; toName: string | null; changedByName: string; changedAt: Date };

/** The assignment history of a request, oldest first. */
export async function listPicAssignments(db: PrismaClient, viewer: Actor, requestId: string): Promise<PicAssignmentRow[]> {
  if (!can(viewer.role, "requests.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.requestPicAssignment.findMany({
    where: { requestId, request: { project: { deletedAt: null } } },
    orderBy: [{ changedAt: "asc" }, { id: "asc" }],
    select: { id: true, changedAt: true, fromPic: { select: { name: true } }, toPic: { select: { name: true } }, changedBy: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, fromName: row.fromPic?.name ?? null, toName: row.toPic?.name ?? null, changedByName: row.changedBy.name, changedAt: row.changedAt }));
}
