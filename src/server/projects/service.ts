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
import { categoryOf } from "@/domain/projects/growth";
import { salesActsOn } from "@/domain/projects/source";
import { notify, projectAudience } from "@/server/notifications/service";
import {
  COMMERCIAL_FIELDS,
  COMMERCIAL_KEYS,
  diffCommercial,
  parseCommercialValue,
  type CommercialField,
  type CommercialValue,
} from "@/domain/projects/commercial";

export type Actor = { id: string; role: Role };

const MAX_FIELD_LENGTH = 4000;

/** `2026-10-17`: the calendar day of a moment in Asia/Jakarta, the business time zone. */
const jakartaDay = (moment: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(moment);

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
    return { ok: false, code: "INVALID_INPUT", message: issue?.code === "unrecognized_keys" ? "That field cannot be changed here." : (issue?.message ?? "The submitted data is invalid.") };
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
      return { ok: false, code: "INVALID_INPUT", message: "Opportunity date cannot be in the future." };
    }
    submitted[field] = result.value;
  }
  // The target margin is a percentage or an amount, never both: filling one clears the other.
  const [pct, amount] = [submitted.targetMargin ?? null, submitted.targetMarginValue ?? null];
  if (pct !== null && amount !== null) return { ok: false, code: "INVALID_INPUT", message: "Enter the target margin as a percentage or as an amount, not both." };
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
      return { ok: false, code: "FORBIDDEN", message: "You can only change the commercial details of your own projects." } satisfies CommercialResult;
    }

    const dateText = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
    const current = {
      createdAt: jakartaDay(project.createdAt),
      progress: project.progress,
      trackStatus: project.trackStatus,
      estimatedValue: project.estimatedValue?.toNumber() ?? null,
      targetMargin: project.targetMargin?.toNumber() ?? null,
      targetMarginValue: project.targetMarginValue?.toNumber() ?? null,
      quoteReleasedAt: dateText(project.quoteReleasedAt),
      targetDate: dateText(project.targetDate),
      finalValue: project.finalValue?.toNumber() ?? null,
      wonDate: dateText(project.wonDate),
    };
    // The three stage dates (Opportunity = created, Quoted = quote released, Closed Won = won date) are kept in step with Progress in
    // both directions. Setting a Quoted or Closed Won date by hand is what the sales export calls reaching that stage, so it moves
    // Progress forward to match, the same as it would if Progress had been changed instead; typing a date never moves Progress back.
    if (
      "quoteReleasedAt" in submitted &&
      submitted.quoteReleasedAt !== null &&
      submitted.quoteReleasedAt !== current.quoteReleasedAt &&
      categoryOf(String(submitted.progress ?? current.progress)) === "OPPORTUNITY"
    ) {
      submitted.progress = "PROPOSE";
    }
    if (
      "wonDate" in submitted &&
      submitted.wonDate !== null &&
      submitted.wonDate !== current.wonDate &&
      (submitted.progress ?? current.progress) !== "CLOSED_WON"
    ) {
      submitted.progress = "CLOSED_WON";
    }
    // Closing a project as won with no won date puts it in the quarter it was closed in (today), so it counts toward the target.
    if (submitted.progress === "CLOSED_WON" && current.progress !== "CLOSED_WON" && current.wonDate === null && (submitted.wonDate ?? null) === null) {
      submitted.wonDate = jakartaDay(new Date());
    }
    // Moving to Propose (30%) means the quotation was submitted: with no date yet, today is filled in. It stays editable (and can be
    // cleared) afterwards, so a date typed in the same change wins and later schedule changes are free.
    if (submitted.progress === "PROPOSE" && current.progress !== "PROPOSE" && current.quoteReleasedAt === null && (submitted.quoteReleasedAt ?? null) === null) {
      submitted.quoteReleasedAt = jakartaDay(new Date());
    }
    const changes = diffCommercial(current, submitted);
    if (changes.length === 0) return { ok: true, changed: [] } satisfies CommercialResult;

    await tx.project.update({
      where: { id: project.id },
      data: Object.fromEntries(
        changes.map((change) => {
          const value = submitted[change.field] ?? null; // already a number, a date string or null
          // The creation date is a moment, not a plain date: the chosen day starts at midnight in Jakarta.
          if (change.field === "createdAt") return [change.field, new Date(`${value}T00:00:00+07:00`)];
          const isDate = change.field === "targetDate" || change.field === "quoteReleasedAt" || change.field === "wonDate";
          return [change.field, isDate && typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value];
        }),
      ),
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
        action: "project.commercial_updated",
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
      title: `${project.code} commercial details updated`,
      body: `${project.endUserCompany}: ${changes.map((change) => fieldLabel(change.field)).join(", ")}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, changed: changes.map((change) => change.field) } satisfies CommercialResult;
  });
}
