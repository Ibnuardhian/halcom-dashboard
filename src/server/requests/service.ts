import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { setActor } from "@/server/projects/actor-context";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { allowedTransitions, canHandOver, canTransition, isOpen, nextRequestType, PO_NEEDS_RFQ, reasonRequired, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { canContinueFlow, workPermission } from "@/domain/requests/access";
import { parseCommercialValue } from "@/domain/projects/commercial";
import { z } from "zod";
import { canCreateProjectWithSource, canRaiseRequestOn, canRaiseWithNewProject, normaliseSource, salesActsOn } from "@/domain/projects/source";
import type { ProjectProgress, TrackStatus } from "@/domain/projects/progress";
import type { RequestType } from "@/domain/requests/types";
import { notify, projectAudience, usersWithRole } from "@/server/notifications/service";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { OWNING_ROLE } from "@/domain/requests/types";
import { jakartaDay } from "@/domain/requests/metrics";
import { codePrefixFor, codePrefixForPic, nextProjectCode, nextRequestCode, recodeFor } from "./codes";
import { ensureCustomer } from "./master-data";
import { REVISION_REQUESTED_KIND, REVISION_STARTED_KIND } from "@/domain/notifications/kinds";
import { createProjectSchema, createRequestSchema, handoverSchema, phaseSchema, requestDatesSchema, revisionSchema, statusChangeSchema, stopFlowSchema } from "./schemas";

export type Actor = { id: string; role: Role };

const ERROR_MESSAGES = {
  FORBIDDEN: "Anda tidak diizinkan melakukan ini.",
  NOT_FOUND: "Data tidak ditemukan.",
  INVALID_INPUT: "Data yang dikirim tidak valid.",
  INVALID_STATE: "Ini tidak bisa dilakukan pada status saat ini.",
  PROJECT_NOT_ACTIVE: "Request hanya dapat ditambahkan ke proyek yang berstatus On Track.",
} as const;

export type WorkErrorCode = keyof typeof ERROR_MESSAGES;

export type WorkResult<T> = { ok: true; value: T } | { ok: false; code: WorkErrorCode; message: string };

function fail(code: WorkErrorCode, message: string = ERROR_MESSAGES[code]): WorkResult<never> {
  return { ok: false, code, message };
}

function succeed<T>(value: T): WorkResult<T> {
  return { ok: true, value };
}

type Tx = Prisma.TransactionClient;

type StoredActor = { id: string; role: Role; email: string; name: string };

/**
 * Re-reads the actor from the database inside the transaction. A user who was deactivated or
 * demoted a moment ago cannot act on a session that still claims the old role.
 */
async function loadActor(tx: Tx, claimed: Actor): Promise<StoredActor | null> {
  const user = await tx.user.findUnique({
    where: { id: claimed.id },
    select: { id: true, role: true, email: true, name: true, isActive: true },
  });
  return user?.isActive ? { id: user.id, role: user.role, email: user.email, name: user.name } : null;
}

function audit(
  tx: Tx,
  actorId: string,
  entityType: "project" | "request",
  action: string,
  entityId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue | null,
) {
  return tx.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      before: before ?? Prisma.JsonNull,
      after: after ?? Prisma.JsonNull,
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export type CreatedRecord = { id: string; code: string; created: boolean };

/** Result of creating a project, with the code of the request that was raised together with it, if any. */
export type CreatedProject = CreatedRecord & { requestCode: string | null };

type NewRequest = { type: RequestType; title: string; description: string | null; requiredBy: Date | null };

/** Inserts a request with its first status-history row and audit event, inside the caller's transaction. */
async function insertRequest(tx: Tx, actor: StoredActor, projectId: string, request: NewRequest, submissionKey: string | null) {
  const code = await nextRequestCode(tx, request.type, actor, new Date());
  const created = await tx.request.create({
    data: {
      code,
      type: request.type,
      projectId,
      title: request.title,
      description: request.description ?? "",
      requiredBy: request.requiredBy,
      requesterId: actor.id,
      submissionKey,
    },
  });
  await tx.requestStatusHistory.create({ data: { requestId: created.id, fromStatus: null, toStatus: "SUBMITTED", changedById: actor.id } });
  await audit(tx, actor.id, "request", "request.created", created.id, null, { code, type: request.type, projectId });
  // The team that owns this kind of request (SOA for a BOQ, Purchasing for an RFQ or a PO) is told it arrived.
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { endUserCompany: true, name: true, salesOwnerId: true, technicalPicId: true } });
  // An RFQ that Purchasing raised itself is still the Sales PIC's project: the Sales PIC and the technical (SOA) PIC are told too. It already
  // shows on the Sales dashboard, which counts requests by the project's owner.
  const alsoTold = actor.role === "PURCHASING" ? [project?.salesOwnerId ?? null, project?.technicalPicId ?? null] : [];
  await notify(tx, {
    actorId: actor.id,
    recipientIds: [...(await usersWithRole(tx, OWNING_ROLE[request.type])), ...alsoTold],
    kind: "request.created",
    title: `New ${request.type} request ${code}`,
    body: `${project?.endUserCompany} – ${project?.name}: ${request.title}`,
    href: `/request/${code}`,
  });
  return { id: created.id, code };
}

/**
 * Creates a project and, when asked, its first BOQ, RFQ or PO request in the same transaction, so Sales fill in one
 * form and either both exist or neither does. A repeated submit (same key) returns the first project and raises no
 * second request.
 */
export async function createProject(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<WorkResult<CreatedProject>> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  const source = normaliseSource(parsed.data);
  if (!source.ok) return fail("INVALID_INPUT", source.message);
  const { sourceType, ...externalSource } = source.value;
  if (!canCreateProjectWithSource(claimedActor.role, sourceType)) return fail("FORBIDDEN");
  const { endUserCompany, name, description, targetDate, request, submissionKey } = parsed.data;
  if (request && !canRaiseWithNewProject(claimedActor.role, request.type, sourceType)) return fail("FORBIDDEN");
  // SOA register an Internal Sales project for a salesperson they choose; nobody else picks the owner (a salesperson owns their own).
  const chosenOwner = parsed.data.salesOwnerId;
  if (sourceType === "INTERNAL_SALES" && claimedActor.role === "SOA") {
    if (!chosenOwner) return fail("INVALID_INPUT", "Pilih salesperson pemilik proyek ini.");
    if (!z.uuid().safeParse(chosenOwner).success) return fail("INVALID_INPUT", "Pilih salesperson dari daftar.");
  }
  // A new project has no RFQ yet, so it cannot start with a PO (BOQ -> RFQ -> PO; only the BOQ can be skipped).
  if (request?.type === "PO") return fail("INVALID_STATE", PO_NEEDS_RFQ);

  // Value, margin and progress are Sales' to enter (docs/requirements/RBAC.md A-10); a role without that right cannot set them here.
  const commercialGiven = (["estimatedValue", "targetMargin", "targetMarginValue", "progress", "trackStatus"] as const).some((field) => parsed.data[field] !== null);
  if (commercialGiven && !can(claimedActor.role, "projects.edit.commercial")) return fail("FORBIDDEN", "Detail komersial diisi oleh Sales.");

  const commercial: Record<string, number | string | null> = {};
  for (const field of ["estimatedValue", "targetMargin", "targetMarginValue", "progress", "trackStatus"] as const) {
    const result = parseCommercialValue(field, parsed.data[field]);
    if (!result.ok) return fail("INVALID_INPUT", result.message);
    commercial[field] = result.value;
  }
  if (commercial["targetMargin"] !== null && commercial["targetMarginValue"] !== null) return fail("INVALID_INPUT", "Isi target margin sebagai persentase atau sebagai nominal, tidak keduanya.");
  // New projects start at Qualify and On Track; the win probability comes from the chosen progress.
  const progress = (commercial["progress"] ?? "QUALIFY") as ProjectProgress;
  const trackStatus = (commercial["trackStatus"] ?? "ON_TRACK") as TrackStatus;

  const existing = () => db.project.findUnique({ where: { submissionKey: submissionKey! }, select: { id: true, code: true } });
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !canCreateProjectWithSource(actor.role, sourceType)) return fail("FORBIDDEN");
      await setActor(tx, actor.id);
      if (submissionKey) {
        const again = await tx.project.findUnique({ where: { submissionKey }, select: { id: true, code: true } });
        if (again) return succeed({ ...again, created: false, requestCode: null });
      }

      // An Internal Sales project belongs to whoever registers it, or, when SOA register it, to the salesperson they chose.
      let ownerId = actor.id;
      let assignedOwner: { id: string; name: string } | null = null;
      if (sourceType === "INTERNAL_SALES" && can(actor.role, "projects.assign-sales") && chosenOwner) {
        const owner = await tx.user.findUnique({ where: { id: chosenOwner }, select: { id: true, name: true, role: true, isActive: true } });
        if (!owner?.isActive || owner.role !== "SALES") return fail("INVALID_INPUT", "Pilih salesperson aktif dari daftar.");
        ownerId = owner.id;
        assignedOwner = { id: owner.id, name: owner.name };
      } else if (sourceType === "INTERNAL_SALES" && actor.role === "SOA") {
        return fail("INVALID_INPUT", "Pilih salesperson pemilik proyek ini.");
      }

      const code = await nextProjectCode(tx);
      const customerId = await ensureCustomer(tx, endUserCompany);
      const project = await tx.project.create({
        data: {
          code,
          endUserCompany,
          name,
          description,
          targetDate,
          estimatedValue: commercial["estimatedValue"] as number | null,
          progress,
          trackStatus,
          targetMargin: commercial["targetMargin"] as number | null,
          targetMarginValue: commercial["targetMarginValue"] as number | null,
          // A project that starts at Propose (30%) already has its quotation submitted: today, editable later.
          quoteReleasedAt: progress === "PROPOSE" ? new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())}T00:00:00Z`) : null,
          // An Internal Sales project belongs to whoever registers it; a project from another source has no internal Sales PIC.
          sourceType,
          ...externalSource,
          salesOwnerId: sourceType === "INTERNAL_SALES" ? ownerId : null,
          customerId,
          submissionKey,
        },
      });
      await audit(tx, actor.id, "project", "project.created", project.id, null, { code, endUserCompany, name, sourceType, ...externalSource, ...(assignedOwner ? { salesOwnerId: assignedOwner.id } : {}) });
      if (assignedOwner) {
        await notify(tx, { actorId: actor.id, recipientIds: [assignedOwner.id], kind: "project.assigned", title: `${code} was registered for you`, body: `${endUserCompany}: ${name}`, href: `/projects/${code}` });
      }
      let requestCode: string | null = null;
      if (request) {
        if (!canRaiseWithNewProject(actor.role, request.type, sourceType)) return fail("FORBIDDEN");
        requestCode = (await insertRequest(tx, actor, project.id, request, submissionKey ? `${submissionKey}:request` : null)).code;
      }
      return succeed({ id: project.id, code, created: true, requestCode });
    });
  } catch (error) {
    // A concurrent submit with the same key won the race: return its project.
    if (submissionKey && isUniqueViolation(error)) {
      const winner = await existing();
      if (winner) return succeed({ ...winner, created: false, requestCode: null });
    }
    throw error;
  }
}

export async function createRequest(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<WorkResult<CreatedRecord>> {
  const parsed = createRequestSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "requests.create") && !can(claimedActor.role, "requests.create.external") && !can(claimedActor.role, "requests.create.rfq")) return fail("FORBIDDEN");
  const { projectId, type, title, description, requiredBy, submissionKey } = parsed.data;

  const existing = () => db.request.findUnique({ where: { submissionKey: submissionKey! }, select: { id: true, code: true } });
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor) return fail("FORBIDDEN");
      if (submissionKey) {
        const again = await tx.request.findUnique({ where: { submissionKey }, select: { id: true, code: true } });
        if (again) return succeed({ ...again, created: false });
      }
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, trackStatus: true, deletedAt: true, sourceType: true } });
      if (!project || project.deletedAt) return fail("NOT_FOUND", "Project tidak ditemukan.");
      if (!canRaiseRequestOn(actor.role, type, project.sourceType)) return fail("FORBIDDEN");
      if (project.trackStatus !== "ON_TRACK") return fail("PROJECT_NOT_ACTIVE");
      if (type === "PO" && (await tx.request.count({ where: { projectId, type: "RFQ", status: "COMPLETED" } })) === 0) return fail("INVALID_STATE", PO_NEEDS_RFQ);

      const request = await insertRequest(tx, actor, projectId, { type, title, description, requiredBy }, submissionKey);
      return succeed({ id: request.id, code: request.code, created: true });
    });
  } catch (error) {
    if (submissionKey && isUniqueViolation(error)) {
      const winner = await existing();
      if (winner) return succeed({ ...winner, created: false });
    }
    throw error;
  }
}

/**
 * Continues the flow BOQ -> RFQ -> PO: a completed BOQ becomes an RFQ, a completed RFQ becomes a PO (brief §6.1). Completing a
 * request never implies the next step; someone decides: the Sales owner of the project, an admin, or SOA after a BOQ. A BOQ can
 * be skipped by starting with an RFQ. Idempotent: the database allows one request of each type per source request, so a
 * repeated click returns the request that already exists. Continuing undoes an earlier "do not continue".
 */
export async function handOverToPurchasing(
  db: PrismaClient,
  claimedActor: Actor,
  input: unknown,
): Promise<WorkResult<CreatedRecord>> {
  const parsed = handoverSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "requests.handover") && claimedActor.role !== "SALES") return fail("FORBIDDEN");
  const { sourceId, targetType } = parsed.data;

  const existing = () =>
    db.request.findUnique({
      where: { sourceRequestId_type: { sourceRequestId: sourceId, type: targetType } },
      select: { id: true, code: true },
    });
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor) return fail("FORBIDDEN");

      await tx.$executeRaw`SELECT id FROM requests WHERE id = ${sourceId}::uuid FOR UPDATE`;
      const source = await tx.request.findUnique({ where: { id: sourceId }, include: { project: { select: { trackStatus: true, salesOwnerId: true, sourceType: true, deletedAt: true } } } });
      if (!source || source.project.deletedAt) return fail("NOT_FOUND", "Request tidak ditemukan.");
      if (!canContinueFlow(actor.role, source.type, salesActsOn(source.project, actor.id))) return fail("FORBIDDEN");
      if (!canHandOver(source.type, source.status)) {
        return fail("INVALID_STATE", "Hanya BOQ atau RFQ yang sudah selesai yang dapat dilanjutkan ke langkah berikutnya.");
      }
      if (targetType !== nextRequestType(source.type)) {
        return fail("INVALID_STATE", "Alurnya BOQ, lalu RFQ, lalu PO: BOQ dilanjutkan sebagai RFQ, dan RFQ sebagai PO.");
      }
      const again = await tx.request.findUnique({
        where: { sourceRequestId_type: { sourceRequestId: source.id, type: targetType } },
        select: { id: true, code: true },
      });
      if (again) return succeed({ ...again, created: false });
      if (source.project.trackStatus !== "ON_TRACK") return fail("PROJECT_NOT_ACTIVE");

      const code = await nextRequestCode(tx, targetType, actor, new Date());
      // A handed-over request arrives In progress: the team does not have to accept it first.
      const request = await tx.request.create({
        data: {
          code,
          type: targetType,
          status: "IN_PROGRESS",
          projectId: source.projectId,
          title: source.title,
          description: source.description,
          requiredBy: source.requiredBy,
          requesterId: actor.id,
          sourceRequestId: source.id,
        },
      });
      await tx.requestStatusHistory.create({
        data: { requestId: request.id, fromStatus: null, toStatus: "IN_PROGRESS", changedById: actor.id, reason: `Handed over from ${source.code}` },
      });
      await tx.request.update({ where: { id: source.id }, data: { flowStoppedAt: null, flowStoppedById: null, flowStoppedNote: null } });
      await audit(tx, actor.id, "request", "request.handed_over", request.id, null, {
        code,
        type: targetType,
        sourceId: source.id,
        sourceCode: source.code,
      });
      await notify(tx, {
        actorId: actor.id,
        recipientIds: [...(await usersWithRole(tx, OWNING_ROLE[targetType])), source.requesterId, source.project.salesOwnerId],
        kind: "request.handed_over",
        title: `${source.code} was handed over as ${targetType} ${code}`,
        body: source.title,
        href: `/request/${code}`,
      });
      return succeed({ id: request.id, code, created: true });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await existing();
      if (winner) return succeed({ ...winner, created: false });
    }
    throw error;
  }
}

/**
 * Sales decide not to continue to the next step after a completed BOQ or RFQ (no RFQ after the BOQ, no PO after the RFQ). The
 * decision is recorded on the request with a note and audited; the teams are told. It can be undone by continuing later.
 */
export async function stopFlow(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<WorkResult<{ code: string }>> {
  const parsed = stopFlowSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "requests.handover") && claimedActor.role !== "SALES") return fail("FORBIDDEN");
  const { sourceId, note } = parsed.data;

  return db.$transaction(async (tx) => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN");
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${sourceId}::uuid FOR UPDATE`;
    const source = await tx.request.findUnique({
      where: { id: sourceId },
      include: { project: { select: { salesOwnerId: true, sourceType: true, deletedAt: true } }, handovers: { select: { id: true } } },
    });
    if (!source || source.project.deletedAt) return fail("NOT_FOUND", "Request tidak ditemukan.");
    if (!canContinueFlow(actor.role, source.type, salesActsOn(source.project, actor.id))) return fail("FORBIDDEN");
    if (!canHandOver(source.type, source.status)) return fail("INVALID_STATE", "Hanya BOQ atau RFQ yang sudah selesai yang memiliki langkah berikutnya untuk diputuskan.");
    if (source.handovers.length > 0) return fail("INVALID_STATE", "Request ini sudah dilanjutkan.");

    await tx.request.update({ where: { id: source.id }, data: { flowStoppedAt: new Date(), flowStoppedById: actor.id, flowStoppedNote: note } });
    await audit(tx, actor.id, "request", "request.flow_stopped", source.id, null, { code: source.code, note });
    const next = nextRequestType(source.type)!;
    await notify(tx, {
      actorId: actor.id,
      // The team that owns the request type is told too: its tickets are handed to PICs, who are not accounts, so the team's accounts are the audience.
      recipientIds: [source.requesterId, source.project.salesOwnerId, ...(await usersWithRole(tx, OWNING_ROLE[source.type]))],
      kind: "request.flow_stopped",
      title: `${source.code}: not continuing to ${next}`,
      body: note,
      href: `/request/${source.code}`,
    });
    return succeed({ code: source.code });
  });
}

/** Moves a request to a new status. The status change, its history row and the audit event commit together. */
export async function changeRequestStatus(
  db: PrismaClient,
  claimedActor: Actor,
  input: unknown,
): Promise<WorkResult<{ code: string; status: string }>> {
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  const { requestId, to, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN");

    // Serialise concurrent changes of one request: the second caller sees the first one's result.
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({ where: { id: requestId } });
    if (!request) return fail("NOT_FOUND", "Request tidak ditemukan.");
    const project = await tx.project.findUnique({ where: { id: request.projectId }, select: { salesOwnerId: true, sourceType: true } });
    // Only the team that works on this type moves its requests (SOA for a BOQ, Purchasing for an RFQ or PO; admins too).
    if (!can(actor.role, workPermission(request.type))) return fail("FORBIDDEN");

    if (!canTransition(request.status, to, request.type)) {
      const options = allowedTransitions(request.status, request.type).map((s) => REQUEST_STATUS_LABELS[s]);
      return fail(
        "INVALID_STATE",
        `A ${REQUEST_STATUS_LABELS[request.status]} request cannot become ${REQUEST_STATUS_LABELS[to]}.` +
          (options.length > 0 ? ` Allowed: ${options.join(", ")}.` : " It is final."),
      );
    }
    if (reasonRequired(request.status, to) && !reason) return fail("INVALID_INPUT", "Isi alasan untuk perubahan ini.");

    const now = new Date();
    await tx.request.update({
      where: { id: request.id },
      data: {
        status: to,
        // Completing a revised BOQ again keeps the first completion, so a revision does not make the SLA late; a revision keeps it too.
        completedAt: to === "COMPLETED" ? (request.status === "REVISION" ? (request.completedAt ?? now) : now) : to === "REVISION" ? request.completedAt : null,
      },
    });
    await tx.requestStatusHistory.create({
      data: { requestId: request.id, fromStatus: request.status, toStatus: to, changedById: actor.id, changedAt: now, reason },
    });
    await audit(tx, actor.id, "request", "request.status_changed", request.id, { status: request.status }, { status: to, reason });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: [request.requesterId, ...(project ? [project.salesOwnerId] : [])],
      kind: to === "REVISION" ? REVISION_STARTED_KIND : "request.status_changed",
      title: `${request.code} is now ${REQUEST_STATUS_LABELS[to]}`,
      body: reason,
      href: `/request/${request.code}`,
    });
    return succeed({ code: request.code, status: to });
  });
}


/**
 * Sales ask for a revision of a completed BOQ (the customer wants changes, agreed with Sales by email). The ticket goes straight to the
 * Revision stage, the reason is kept in the status history, and SOA (the team and the project's technical PIC) is told with a notification
 * that is shown in red. Only a Completed BOQ can be sent back, and a salesperson only on a project they act on (their own, or one from
 * another source). Admins may do it for a project. SOA moves a BOQ to Revision on the board as before; this is the Sales side of it.
 */
export async function requestRevision(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<WorkResult<{ code: string }>> {
  const parsed = revisionSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "requests.revise")) return fail("FORBIDDEN");
  const { requestId, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor || !can(actor.role, "requests.revise")) return fail("FORBIDDEN");

    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({
      where: { id: requestId },
      include: { project: { select: { salesOwnerId: true, sourceType: true, technicalPicId: true, deletedAt: true, endUserCompany: true, name: true } } },
    });
    if (!request || request.project.deletedAt) return fail("NOT_FOUND", "Request tidak ditemukan.");
    if (actor.role === "SALES" && !salesActsOn(request.project, actor.id)) return fail("FORBIDDEN");
    if (request.type !== "BOQ") return fail("INVALID_STATE", "Revisi hanya dapat diminta untuk BOQ.");
    if (!canTransition(request.status, "REVISION", request.type)) return fail("INVALID_STATE", "Hanya BOQ yang sudah selesai yang dapat dikembalikan untuk direvisi.");

    const now = new Date();
    // The first completion stays (a revision does not make the SLA late), exactly as when SOA moves the card to Revision.
    await tx.request.update({ where: { id: request.id }, data: { status: "REVISION" } });
    await tx.requestStatusHistory.create({
      data: { requestId: request.id, fromStatus: request.status, toStatus: "REVISION", changedById: actor.id, changedAt: now, reason },
    });
    await audit(tx, actor.id, "request", "request.revision_requested", request.id, { status: request.status }, { status: "REVISION", reason });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: [...(await usersWithRole(tx, OWNING_ROLE.BOQ)), request.project.technicalPicId],
      kind: REVISION_REQUESTED_KIND,
      title: `${request.code}: revision requested`,
      body: `${request.project.endUserCompany} – ${request.project.name}: ${reason}`,
      href: `/request/${request.code}`,
    });
    return succeed({ code: request.code });
  });
}
/**
 * A superadmin sets when a request was created and when it was completed, by hand, for tickets entered late or recorded wrongly.
 * The status history is append-only and stays as it is; the corrected dates are on the request and every change is audited.
 * A completion date belongs only to a Completed or Revision request (a database check keeps it so) and cannot be before the creation date.
 */
export async function setRequestDates(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<WorkResult<{ code: string }>> {
  const parsed = requestDatesSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "requests.edit-dates")) return fail("FORBIDDEN");
  const { requestId, createdAt, completedAt, requesterId } = parsed.data;
  const today = jakartaDay(new Date());
  if (jakartaDay(createdAt) > today) return fail("INVALID_INPUT", "Tanggal pembuatan tidak boleh di masa depan.");
  if (completedAt && jakartaDay(completedAt) > today) return fail("INVALID_INPUT", "Tanggal penyelesaian tidak boleh di masa depan.");
  if (completedAt && completedAt.getTime() < createdAt.getTime()) return fail("INVALID_INPUT", "Tanggal penyelesaian tidak boleh sebelum tanggal pembuatan.");

  return db.$transaction(async (tx) => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor || !can(actor.role, "requests.edit-dates")) return fail("FORBIDDEN");
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({ where: { id: requestId }, include: { project: { select: { deletedAt: true } } } });
    if (!request || request.project.deletedAt) return fail("NOT_FOUND", "Request tidak ditemukan.");
    const finished = request.status === "COMPLETED" || request.status === "REVISION";
    if (!finished && completedAt) return fail("INVALID_STATE", "Hanya request yang sudah selesai yang memiliki tanggal penyelesaian.");
    // Only days are entered. A day that is the one already stored keeps its exact time, so saving the form never moves a time by itself.
    const nextCreated = jakartaDay(request.createdAt) === jakartaDay(createdAt) ? request.createdAt : createdAt;
    // A finished request keeps a completion date: an empty field leaves the stored one.
    const wantedCompleted = completedAt && request.completedAt && jakartaDay(request.completedAt) === jakartaDay(completedAt) ? request.completedAt : completedAt;
    const nextCompleted = finished ? (wantedCompleted ?? request.completedAt) : null;
    if (nextCompleted && jakartaDay(nextCompleted) < jakartaDay(nextCreated)) return fail("INVALID_INPUT", "Tanggal penyelesaian tidak boleh sebelum tanggal pembuatan.");

    // "Requested by" can be corrected too: an active account, or a SOA PIC who raised it through the shared SOA login ("pic:<id>").
    // What is selected now: the PIC when one is named, else the account.
    const selectedNow = request.raisedByPicId ? `pic:${request.raisedByPicId}` : request.requesterId;
    const selected = requesterId ?? selectedNow;
    let nextRequester = request.requesterId;
    let nextRaisedByPicId: string | null = request.raisedByPicId;
    let nextCode = request.code;
    if (selected !== selectedNow) {
      let prefix: string;
      if (selected.startsWith("pic:")) {
        const pic = await tx.pic.findUnique({ where: { id: selected.slice(4) }, select: { id: true, name: true, team: true, isActive: true, codePrefix: true } });
        if (!pic?.isActive || pic.team !== "SOA") return fail("INVALID_INPUT", "Pilih PIC SOA yang aktif.");
        const shared = await tx.user.findFirst({ where: { role: "SOA", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
        if (!shared) return fail("INVALID_INPUT", "Tidak ada akun SOA yang aktif untuk mengajukan atas nama PIC.");
        nextRequester = shared.id;
        nextRaisedByPicId = pic.id;
        prefix = await codePrefixForPic(tx, pic);
      } else {
        const person = await tx.user.findUnique({ where: { id: selected }, select: { id: true, email: true, isActive: true, codePrefix: true } });
        if (!person?.isActive) return fail("INVALID_INPUT", "Pemohon harus akun yang aktif.");
        nextRequester = person.id;
        nextRaisedByPicId = null;
        prefix = person.codePrefix ?? (await codePrefixFor(tx, person));
      }
      // The code follows the new requester: their prefix and their next number (the year of the old code is kept). The same prefix keeps the code.
      const [, oldPrefix, serial] = request.code.split("-");
      if (prefix !== oldPrefix) nextCode = await recodeFor(tx, request.type, prefix, (serial ?? "").slice(0, 2));
    }

    const before = { code: request.code, createdAt: request.createdAt.toISOString(), completedAt: request.completedAt?.toISOString() ?? null, requesterId: request.requesterId, raisedByPicId: request.raisedByPicId };
    const after = { code: nextCode, createdAt: nextCreated.toISOString(), completedAt: nextCompleted?.toISOString() ?? null, requesterId: nextRequester, raisedByPicId: nextRaisedByPicId };
    if (before.createdAt === after.createdAt && before.completedAt === after.completedAt && before.requesterId === after.requesterId && before.raisedByPicId === after.raisedByPicId) return fail("INVALID_INPUT", "Tidak ada yang berubah.");
    await tx.request.update({ where: { id: request.id }, data: { code: nextCode, createdAt: nextCreated, completedAt: nextCompleted, requesterId: nextRequester, raisedByPicId: nextRaisedByPicId } });
    // Notifications name the code in their text and link; the old link would lead nowhere.
    if (nextCode !== request.code) {
      await tx.$executeRaw`UPDATE notifications SET title = replace(title, ${request.code}, ${nextCode}), body = replace(body, ${request.code}, ${nextCode}), href = replace(href, ${request.code}, ${nextCode}) WHERE title LIKE ${"%" + request.code + "%"} OR body LIKE ${"%" + request.code + "%"} OR href LIKE ${"%" + request.code + "%"}`;
    }
    await audit(tx, actor.id, "request", "request.dates_corrected", request.id, before, after);
    return succeed({ code: nextCode });
  });
}

/**
 * SOA labels a BOQ request with the part of the work it is on: Assessment, Sizing or POC (or clears the label).
 * Only people who work on BOQ requests may do it, and only on a BOQ that is still open. The change is audited and
 * the project's Sales owner and teams are told.
 */
export async function setRequestPhase(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<WorkResult<{ code: string }>> {
  const parsed = phaseSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "requests.work.boq")) return fail("FORBIDDEN");
  const { requestId, phase } = parsed.data;

  return db.$transaction(async (tx) => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor || !can(actor.role, "requests.work.boq")) return fail("FORBIDDEN");

    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({ where: { id: requestId }, include: { project: { select: { code: true, endUserCompany: true } } } });
    if (!request) return fail("NOT_FOUND", "Request tidak ditemukan.");
    if (request.type !== "BOQ") return fail("INVALID_STATE", "Hanya request BOQ yang memiliki SOA phase.");
    if (!isOpen(request.status)) return fail("INVALID_STATE", "Request ini sudah ditutup.");
    if (request.phase === phase) return succeed({ code: request.code });

    // Labelling the work with a phase means SOA has started it: a request nobody had touched goes to In progress by itself.
    const starts = phase !== null && request.status === "SUBMITTED";
    await tx.request.update({
      where: { id: request.id },
      data: { phase, ...(starts ? { status: "IN_PROGRESS" as const } : {}) },
    });
    if (starts) {
      await tx.requestStatusHistory.create({
        data: { requestId: request.id, fromStatus: "SUBMITTED", toStatus: "IN_PROGRESS", changedById: actor.id, reason: `Started: phase set to ${SOA_PHASE_LABELS[phase]}` },
      });
    }
    await audit(tx, actor.id, "request", "request.phase_changed", request.id, { phase: request.phase }, { phase });
    await notify(tx, {
      actorId: actor.id,
      recipientIds: await projectAudience(tx, request.projectId),
      kind: "request.phase_changed",
      title: phase ? `${request.code} is now in ${SOA_PHASE_LABELS[phase]}` : `${request.code}: phase cleared`,
      body: `${request.project.endUserCompany} (${request.project.code})`,
      href: `/request/${request.code}`,
    });
    return succeed({ code: request.code });
  });
}
