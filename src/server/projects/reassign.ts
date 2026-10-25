import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { notify, projectAudience } from "@/server/notifications/service";

type Actor = { id: string; role: Role };

const idOrBlank = z.union([z.uuid(), z.literal("")]);
const reassignSchema = z
  .object({ projectId: z.uuid(), salesOwnerId: idOrBlank.optional(), technicalPicId: idOrBlank.optional(), purchasingPicId: idOrBlank.optional() })
  .strict();

export type ReassignResult =
  | { ok: true; changed: ("salesOwner" | "technicalPic" | "purchasingPic")[] }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT"; message: string };

/** How a person is written in the change log: the name and the email, because two people can share a name. */
const label = (person: { name: string; email: string }) => `${person.name} (${person.email})`;

/** The PIC slots of a project: the project column, the role the person must have, and the name the change log uses. */
const SLOTS = [
  { key: "salesOwnerId", log: "salesOwner", label: "Sales PIC", role: "SALES", required: true },
  { key: "technicalPicId", log: "technicalPic", label: "Technical PIC (SOA)", role: "SOA", required: false },
  { key: "purchasingPicId", log: "purchasingPic", label: "Purchasing PIC", role: "PURCHASING", required: false },
] as const;

/**
 * Moves a project to other people: its Sales, SOA (technical) and Purchasing PIC. Superadmin only. Nothing else about the
 * project changes: its details, requests, status history, change log and audit trail stay as they were. The move itself
 * is added to the change log and the audit log, and the people involved are told.
 */
export async function reassignProject(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<ReassignResult> {
  const parsed = reassignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Choose valid people for the project." };
  const { projectId } = parsed.data;

  return db.$transaction(async (tx): Promise<ReassignResult> => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "projects.reassign")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };

    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { salesOwner: { select: { name: true, email: true } }, technicalPic: { select: { name: true, email: true } }, purchasingPic: { select: { name: true, email: true } } },
    });
    if (!project || project.deletedAt) return { ok: false, code: "NOT_FOUND", message: "Project tidak ditemukan." };

    const data: Record<string, string | null> = {};
    const changes: { field: string; from: string | null; to: string | null }[] = [];
    const involved = new Set<string>();
    const changed: ("salesOwner" | "technicalPic" | "purchasingPic")[] = [];

    for (const slot of SLOTS) {
      const wanted = parsed.data[slot.key];
      if (wanted === undefined) continue;
      const next = wanted === "" ? null : wanted;
      const current = project[slot.key];
      if (next === current) continue;
      if (slot.key === "salesOwnerId" && project.sourceType === "OTHER") {
        return { ok: false, code: "INVALID_INPUT", message: "This project's source is Other, so it has no internal Sales PIC. Change the project source first." };
      }
      if (next === null && slot.required) return { ok: false, code: "INVALID_INPUT", message: `${slot.label} is required.` };

      let toName: string | null = null;
      if (next !== null) {
        const person = await tx.user.findUnique({ where: { id: next }, select: { name: true, email: true, role: true, isActive: true } });
        if (!person?.isActive || person.role !== slot.role) return { ok: false, code: "INVALID_INPUT", message: `${slot.label} must be an active ${slot.role === "SOA" ? "SOA" : slot.role.charAt(0) + slot.role.slice(1).toLowerCase()} account.` };
        toName = label(person);
        involved.add(next);
      }
      if (current) involved.add(current);
      data[slot.key] = next;
      const was = project[slot.log];
      changes.push({ field: slot.log, from: was ? label(was) : null, to: toName });
      changed.push(slot.log);
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
        action: "project.reassigned",
        entityType: "project",
        entityId: project.id,
        before: Object.fromEntries(changes.map((change) => [change.field, change.from])) as Prisma.InputJsonValue,
        after: Object.fromEntries(changes.map((change) => [change.field, change.to])) as Prisma.InputJsonValue,
      },
    });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: [...involved, ...(await projectAudience(tx, project.id))],
      kind: "project.reassigned",
      title: `${project.code} has new owners`,
      body: `${project.endUserCompany}: ${changes.map((change) => `${change.field === "salesOwner" ? "Sales PIC" : change.field === "technicalPic" ? "Technical PIC" : "Purchasing PIC"} ${change.from ?? "none"} → ${change.to ?? "none"}`).join("; ")}`,
      href: `/projects/${project.code}`,
    });
    return { ok: true, changed };
  });
}
