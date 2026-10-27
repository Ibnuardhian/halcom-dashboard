import { z } from "zod";
import { setActor } from "./actor-context";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import {
  diffFields,
  fieldLabel,
  PROJECT_EDITABLE_KEYS,
  type FieldChange,
  type ProjectEditableField,
} from "@/domain/projects/fields";
import { ACTION_BODY_MAX_LENGTH, ACTION_KINDS } from "@/domain/projects/actions";
import { salesActsOn } from "@/domain/projects/source";
import { notify, projectAudience } from "@/server/notifications/service";
import { jakartaDay, planCommercialChanges, writeCommercialChanges } from "./commercial-plan";
import {
  COMMERCIAL_FIELDS,
  COMMERCIAL_KEYS,
  parseCommercialValue,
  type CommercialField,
  type CommercialValue,
} from "@/domain/projects/commercial";

export type Actor = { id: string; role: Role };

const MAX_FIELD_LENGTH = 4000;


/**
 * Only the keys of PROJECT_EDITABLE_FIELDS are accepted, and `.strict()` rejects any other key, so a
 * crafted request cannot slip a commercial field (value, probability, stage, status) through this door.
 */
const updateSchema = z.object({
  projectId: z.uuid(),
  values: z
    .object(
      Object.fromEntries(
        PROJECT_EDITABLE_KEYS.map((key) => [
          key,
          z.string().max(MAX_FIELD_LENGTH, `Setiap field maksimal ${MAX_FIELD_LENGTH} karakter.`).nullish(),
        ]),
      ) as Record<ProjectEditableField, z.ZodOptional<z.ZodNullable<z.ZodString>>>,
    )
    .strict(),
});

export type UpdateErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT";

export type UpdateResult =
  | { ok: true; changed: ProjectEditableField[] }
  | { ok: false; code: UpdateErrorCode; message: string };

function fail(code: UpdateErrorCode, message: string): UpdateResult {
  return { ok: false, code, message };
}

/**
 * Changes the technical and progress fields of a project (SOA's part of the project record).
 * The change, one log row per changed field, and the audit event commit together. Fields that are
 * not submitted are untouched, and a field submitted with its current value writes nothing.
 */
export async function updateProjectDetails(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<UpdateResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("INVALID_INPUT", issue?.code === "unrecognized_keys" ? "Field itu tidak dapat diubah di sini." : (issue?.message ?? "Data yang dikirim tidak valid."));
  }
  if (!can(claimedActor.role, "projects.edit.technical")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
  const { projectId, values } = parsed.data;

  return db.$transaction(async (tx) => {
    // The stored role decides, so a demoted or deactivated user cannot act on a stale session.
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.edit.technical")) return fail("FORBIDDEN", "Anda tidak diizinkan melakukan ini.");
    await setActor(tx, actor.id);

    // Serialise concurrent edits of one project, so each log row's "from" is the value really replaced.
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.deletedAt) return fail("NOT_FOUND", "Project tidak ditemukan.");

    const changes: FieldChange[] = diffFields(project, values);
    if (changes.length === 0) return { ok: true, changed: [] } satisfies UpdateResult;

    await tx.project.update({
      where: { id: project.id },
      data: Object.fromEntries(changes.map((change) => [change.field, change.to])),
    });
    const now = new Date();
    await tx.projectChange.createMany({
      data: changes.map((change) => ({
        projectId: project.id,
        changedById: actor.id,
        field: change.field,
        fromValue: change.from,
        toValue: change.to,
        changedAt: now,
      })),
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "project.details_updated",
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
      title: `${project.code} technical details updated`,
      body: `${project.endUserCompany}: ${changes.map((change) => fieldLabel(change.field)).join(", ")}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, changed: changes.map((change) => change.field) } satisfies UpdateResult;
  });
}

const postSchema = z.object({
  projectId: z.uuid(),
  kind: z.enum(ACTION_KINDS, "Pilih current action atau next action."),
  body: z
    .string()
    .trim()
    .min(1, "Tulis apa yang sudah dikerjakan atau apa yang berikutnya.")
    .max(ACTION_BODY_MAX_LENGTH, `Update maksimal ${ACTION_BODY_MAX_LENGTH} karakter.`),
});

export type PostResult = { ok: true; id: string } | { ok: false; code: UpdateErrorCode; message: string };

/**
 * Adds a current-action or next-action entry to a project's feed, like a comment: it records the text, the
 * author and the time, and is never edited afterwards. The project keeps the text of the latest entry of each
 * kind, written in the same transaction as the entry and an audit event.
 */
export async function postProjectUpdate(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PostResult> {
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid." };
  if (!can(claimedActor.role, "projects.post-update")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };
  const { projectId, kind, body } = parsed.data;

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.post-update")) {
      return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." } satisfies PostResult;
    }
    // Serialise updates of one project, so "the latest entry" and the project's copy of it never disagree.
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, endUserCompany: true, deletedAt: true } });
    if (!project || project.deletedAt) return { ok: false, code: "NOT_FOUND", message: "Project tidak ditemukan." } satisfies PostResult;

    const entry = await tx.projectAction.create({ data: { projectId, kind, body, authorId: actor.id }, select: { id: true } });
    await tx.project.update({ where: { id: projectId }, data: kind === "CURRENT" ? { currentAction: body } : { nextAction: body } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "project.action_posted",
        entityType: "project",
        entityId: projectId,
        before: Prisma.JsonNull,
        after: { kind, body } as Prisma.InputJsonValue,
      },
    });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: await projectAudience(tx, projectId),
      kind: "project.updated",
      title: `${project.code} ${kind === "CURRENT" ? "current action" : "next action"} updated`,
      body: `${project.endUserCompany}: ${body}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, id: entry.id } satisfies PostResult;
  });
}

const commercialSchema = z.object({
  projectId: z.uuid(),
  values: z
    .object(Object.fromEntries(COMMERCIAL_KEYS.map((key) => [key, z.string().max(40).nullish()])) as Record<CommercialField, z.ZodOptional<z.ZodNullable<z.ZodString>>>)
    .strict(),
});

export type CommercialResult = { ok: true; changed: CommercialField[] } | { ok: false; code: UpdateErrorCode; message: string };

/**
 * Changes the commercial fields of a project (value, target margin, target closing). Sales may change
 * only projects they own; admins and superadmins any project. Same guarantees as the technical edit: whitelist of
 * keys, stored actor re-read in the transaction, row lock, one change-log row per changed field, one audit event.
 */
export async function updateCommercialDetails(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<CommercialResult> {
  const parsed = commercialSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, code: "INVALID_INPUT", message: issue?.code === "unrecognized_keys" ? "Field itu tidak dapat diubah di sini." : (issue?.message ?? "Data yang dikirim tidak valid.") };
  }
  if (!can(claimedActor.role, "projects.edit.commercial")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };
  const { projectId, values } = parsed.data;

  const submitted: Partial<Record<CommercialField, CommercialValue>> = {};
  for (const field of COMMERCIAL_KEYS) {
    if (!(field in values)) continue;
    const result = parseCommercialValue(field, values[field]);
    if (!result.ok) return { ok: false, code: "INVALID_INPUT", message: result.message };
    // Progress, Status and the creation date always have a value: choosing "nothing" is not a change but a mistake.
    if ((field === "progress" || field === "trackStatus" || field === "createdAt") && result.value === null) {
      return { ok: false, code: "INVALID_INPUT", message: `${COMMERCIAL_FIELDS[field].label} is required.` };
    }
    if (field === "createdAt" && typeof result.value === "string" && result.value > jakartaDay(new Date())) {
      return { ok: false, code: "INVALID_INPUT", message: "Opportunity date tidak boleh di masa depan." };
    }
    submitted[field] = result.value;
  }
  // The target margin is a percentage or an amount, never both: filling one clears the other.
  const [pct, amount] = [submitted.targetMargin ?? null, submitted.targetMarginValue ?? null];
  if (pct !== null && amount !== null) return { ok: false, code: "INVALID_INPUT", message: "Isi target margin sebagai persentase atau sebagai nominal, tidak keduanya." };
  if (pct !== null && !("targetMarginValue" in submitted)) submitted.targetMarginValue = null;
  if (amount !== null && !("targetMargin" in submitted)) submitted.targetMargin = null;

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.edit.commercial")) {
      return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." } satisfies CommercialResult;
    }
    await setActor(tx, actor.id);
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.deletedAt) return { ok: false, code: "NOT_FOUND", message: "Project tidak ditemukan." } satisfies CommercialResult;
    // Sales work on their own projects; the other roles that hold this permission (admins) support any project.
    if (actor.role === "SALES" && !salesActsOn(project, actor.id)) {
      return { ok: false, code: "FORBIDDEN", message: "Anda hanya dapat mengubah detail komersial proyek milik Anda sendiri." } satisfies CommercialResult;
    }

    const changes = planCommercialChanges(project, submitted);
    if (changes.length === 0) return { ok: true, changed: [] } satisfies CommercialResult;
    await writeCommercialChanges(tx, actor.id, project, submitted, changes);
    await notify(tx, {
      actorId: actor.id,
      recipientIds: await projectAudience(tx, project.id),
      kind: "project.updated",
      title: `${project.code} commercial details updated`,
      body: `${project.endUserCompany}: ${changes.map((change) => fieldLabel(change.field)).join(", ")}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, changed: changes.map((change) => change.field) } satisfies CommercialResult;
  });
}
