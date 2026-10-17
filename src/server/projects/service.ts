import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import {
  diffFields,
  PROJECT_EDITABLE_KEYS,
  type FieldChange,
  type ProjectEditableField,
} from "@/domain/projects/fields";
import { ACTION_BODY_MAX_LENGTH, ACTION_KINDS } from "@/domain/projects/actions";

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
          z.string().max(MAX_FIELD_LENGTH, `Each field can hold at most ${MAX_FIELD_LENGTH} characters.`).nullish(),
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
    return fail("INVALID_INPUT", issue?.code === "unrecognized_keys" ? "That field cannot be changed here." : (issue?.message ?? "The submitted data is invalid."));
  }
  if (!can(claimedActor.role, "projects.edit.technical")) return fail("FORBIDDEN", "You are not allowed to do that.");
  const { projectId, values } = parsed.data;

  return db.$transaction(async (tx) => {
    // The stored role decides, so a demoted or deactivated user cannot act on a stale session.
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.edit.technical")) return fail("FORBIDDEN", "You are not allowed to do that.");

    // Serialise concurrent edits of one project, so each log row's "from" is the value really replaced.
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return fail("NOT_FOUND", "Project not found.");

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
    return { ok: true, changed: changes.map((change) => change.field) } satisfies UpdateResult;
  });
}

const postSchema = z.object({
  projectId: z.uuid(),
  kind: z.enum(ACTION_KINDS, "Choose current action or next action."),
  body: z
    .string()
    .trim()
    .min(1, "Write what was done or what comes next.")
    .max(ACTION_BODY_MAX_LENGTH, `An update can hold at most ${ACTION_BODY_MAX_LENGTH} characters.`),
});

export type PostResult = { ok: true; id: string } | { ok: false; code: UpdateErrorCode; message: string };

/**
 * Adds a current-action or next-action entry to a project's feed, like a comment: it records the text, the
 * author and the time, and is never edited afterwards. The project keeps the text of the latest entry of each
 * kind, written in the same transaction as the entry and an audit event.
 */
export async function postProjectUpdate(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PostResult> {
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "The submitted data is invalid." };
  if (!can(claimedActor.role, "projects.post-update")) return { ok: false, code: "FORBIDDEN", message: "You are not allowed to do that." };
  const { projectId, kind, body } = parsed.data;

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.post-update")) {
      return { ok: false, code: "FORBIDDEN", message: "You are not allowed to do that." } satisfies PostResult;
    }
    // Serialise updates of one project, so "the latest entry" and the project's copy of it never disagree.
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return { ok: false, code: "NOT_FOUND", message: "Project not found." } satisfies PostResult;

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
    return { ok: true, id: entry.id } satisfies PostResult;
  });
}
