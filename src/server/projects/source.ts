import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { EXTERNAL_SOURCE_KEYS, normaliseSource, SOURCE_LABELS } from "@/domain/projects/source";
import { notify, projectAudience } from "@/server/notifications/service";

type Actor = { id: string; role: Role };

/** Strict: only the source fields (and, when adopting a project, the new Sales PIC) can be sent through this door. */
const schema = z
  .object({
    projectId: z.uuid(),
    sourceType: z.string().nullish(),
    externalSourceName: z.string().max(4000).nullish(),
    externalContact: z.string().max(4000).nullish(),
    externalReference: z.string().max(4000).nullish(),
    sourceNotes: z.string().max(4000).nullish(),
    salesOwnerId: z.union([z.uuid(), z.literal("")]).nullish(),
  })
  .strict();

export type SourceUpdateResult =
  | { ok: true; changed: string[] }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT"; message: string };

const FORBIDDEN = { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." } as const;

/**
 * Changes where a project came from. For a project from another source that means its external details; it can also be
 * adopted by the internal Sales team (source Internal Sales with a Sales PIC). An Internal Sales project cannot become Other:
 * that would drop its Sales PIC and the targets that count it. Each changed field is added to the project's change log and
 * the audit log in the same transaction as the change; the source rules are checked here, and by a database constraint.
 */
export async function updateProjectSource(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<SourceUpdateResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0]?.code === "unrecognized_keys" ? "That field cannot be changed here." : "The submitted data is invalid." };
  }
  if (!can(claimedActor.role, "projects.edit.source")) return FORBIDDEN;
  const wanted = normaliseSource(parsed.data);
  if (!wanted.ok) return { ok: false, code: "INVALID_INPUT", message: wanted.message };
  const { projectId, salesOwnerId } = parsed.data;

  return db.$transaction(async (tx): Promise<SourceUpdateResult> => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.edit.source")) return FORBIDDEN;

    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, include: { salesOwner: { select: { name: true, email: true } } } });
    if (!project || project.deletedAt) return { ok: false, code: "NOT_FOUND", message: "Project tidak ditemukan." };

    const next = wanted.value;
    if (project.sourceType === "INTERNAL_SALES" && next.sourceType === "OTHER") {
      return { ok: false, code: "INVALID_INPUT", message: "An Internal Sales project cannot be changed to Other: it would lose its Sales PIC." };
    }

    const changes: { field: string; from: string | null; to: string | null }[] = [];
    const data: Prisma.ProjectUncheckedUpdateInput = { sourceType: next.sourceType };
    let newOwnerId: string | null = project.salesOwnerId;

    if (next.sourceType === "INTERNAL_SALES") {
      // Adopting an Other project: it needs an internal Sales PIC, and the external details are cleared.
      if (!salesOwnerId) return { ok: false, code: "INVALID_INPUT", message: "Choose the Sales PIC who takes over this project." };
      const owner = await tx.user.findUnique({ where: { id: salesOwnerId }, select: { id: true, name: true, email: true, role: true, isActive: true } });
      if (!owner?.isActive || owner.role !== "SALES") return { ok: false, code: "INVALID_INPUT", message: "The Sales PIC must be an active Sales account." };
      newOwnerId = owner.id;
      data.salesOwnerId = owner.id;
      changes.push({ field: "salesOwner", from: null, to: `${owner.name} (${owner.email})` });
    } else if (salesOwnerId) {
      return { ok: false, code: "INVALID_INPUT", message: "A project from another source has no internal Sales PIC." };
    }

    if (project.sourceType !== next.sourceType) {
      changes.push({ field: "sourceType", from: SOURCE_LABELS[project.sourceType], to: SOURCE_LABELS[next.sourceType] });
    }
    for (const key of EXTERNAL_SOURCE_KEYS) {
      data[key] = next[key];
      if (project[key] !== next[key]) changes.push({ field: key, from: project[key], to: next[key] });
    }
    if (changes.length === 0) return { ok: true, changed: [] };

    await tx.project.update({ where: { id: project.id }, data });
    const now = new Date();
    await tx.projectChange.createMany({
      data: changes.map((change) => ({ projectId: project.id, changedById: actor.id, field: change.field, fromValue: change.from, toValue: change.to, changedAt: now })),
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "project.source_changed",
        entityType: "project",
        entityId: project.id,
        before: Object.fromEntries(changes.map((change) => [change.field, change.from])) as Prisma.InputJsonValue,
        after: Object.fromEntries(changes.map((change) => [change.field, change.to])) as Prisma.InputJsonValue,
      },
    });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: [newOwnerId, ...(await projectAudience(tx, project.id))],
      kind: "project.updated",
      title: `${project.code} source updated`,
      body: `${project.endUserCompany}: ${changes.map((change) => change.field).join(", ")}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, changed: changes.map((change) => change.field) };
  });
}
