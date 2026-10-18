import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { allowedTransitions, canHandOver, canTransition, nextRequestType, PO_NEEDS_RFQ, reasonRequired, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { canContinueFlow, workPermission } from "@/domain/requests/access";
import { parseCommercialValue } from "@/domain/projects/commercial";
import { canCreateProjectWithSource, canRaiseRequestOn, normaliseSource, salesActsOn } from "@/domain/projects/source";
import type { ProjectProgress, TrackStatus } from "@/domain/projects/progress";
import type { RequestType } from "@/domain/requests/types";
import { notify, projectAudience, usersWithRole } from "@/server/notifications/service";
import { SOA_PHASE_LABELS } from "@/domain/requests/phase";
import { OWNING_ROLE } from "@/domain/requests/types";
import { nextProjectCode, nextRequestCode } from "./codes";
import { ensureCustomer } from "./master-data";
import { createProjectSchema, createRequestSchema, handoverSchema, phaseSchema, statusChangeSchema, stopFlowSchema } from "./schemas";

export type Actor = { id: string; role: Role };

const ERROR_MESSAGES = {
  FORBIDDEN: "You are not allowed to do that.",
  NOT_FOUND: "The record was not found.",
  INVALID_INPUT: "The submitted data is invalid.",
  INVALID_STATE: "This is not possible in the current status.",
  PROJECT_NOT_ACTIVE: "Requests can only be added to a project that is On Track.",
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
  const code = await nextRequestCode(tx, request.type, actor.email, new Date());
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
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { endUserCompany: true, name: true } });
  await notify(tx, {
    actorId: actor.id,
    recipientIds: await usersWithRole(tx, OWNING_ROLE[request.type]),
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
  if (request && !canRaiseRequestOn(claimedActor.role, request.type, sourceType)) return fail("FORBIDDEN");
  // A new project has no RFQ yet, so it cannot start with a PO (BOQ -> RFQ -> PO; only the BOQ can be skipped).
  if (request?.type === "PO") return fail("INVALID_STATE", PO_NEEDS_RFQ);

  // Value, margin and progress are Sales' to enter (docs/requirements/RBAC.md A-10); a role without that right cannot set them here.
  const commercialGiven = (["estimatedValue", "targetMargin", "targetMarginValue", "progress", "trackStatus"] as const).some((field) => parsed.data[field] !== null);
  if (commercialGiven && !can(claimedActor.role, "projects.edit.commercial")) return fail("FORBIDDEN", "Commercial details are entered by Sales.");

  const commercial: Record<string, number | string | null> = {};
  for (const field of ["estimatedValue", "targetMargin", "targetMarginValue", "progress", "trackStatus"] as const) {
    const result = parseCommercialValue(field, parsed.data[field]);
    if (!result.ok) return fail("INVALID_INPUT", result.message);
    commercial[field] = result.value;
  }
  if (commercial["targetMargin"] !== null && commercial["targetMarginValue"] !== null) return fail("INVALID_INPUT", "Enter the target margin as a percentage or as an amount, not both.");
  // New projects start at Qualify and On Track; the win probability comes from the chosen progress.
  const progress = (commercial["progress"] ?? "QUALIFY") as ProjectProgress;
  const trackStatus = (commercial["trackStatus"] ?? "ON_TRACK") as TrackStatus;

  const existing = () => db.project.findUnique({ where: { submissionKey: submissionKey! }, select: { id: true, code: true } });
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !canCreateProjectWithSource(actor.role, sourceType)) return fail("FORBIDDEN");
      if (submissionKey) {
        const again = await tx.project.findUnique({ where: { submissionKey }, select: { id: true, code: true } });
        if (again) return succeed({ ...again, created: false, requestCode: null });
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
          // An Internal Sales project belongs to whoever registers it; a project from another source has no internal Sales PIC.
          sourceType,
          ...externalSource,
          salesOwnerId: sourceType === "INTERNAL_SALES" ? actor.id : null,
          customerId,
          submissionKey,
        },
      });
      await audit(tx, actor.id, "project", "project.created", project.id, null, { code, endUserCompany, name, sourceType, ...externalSource });
      let requestCode: string | null = null;
      if (request) {
        if (!canRaiseRequestOn(actor.role, request.type, sourceType)) return fail("FORBIDDEN");
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
  if (!can(claimedActor.role, "requests.create") && !can(claimedActor.role, "requests.create.external")) return fail("FORBIDDEN");
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
      if (!project || project.deletedAt) return fail("NOT_FOUND", "Project not found.");
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
      if (!source || source.project.deletedAt) return fail("NOT_FOUND", "Request not found.");
      if (!canContinueFlow(actor.role, source.type, salesActsOn(source.project, actor.id))) return fail("FORBIDDEN");
      if (!canHandOver(source.type, source.status)) {
        return fail("INVALID_STATE", "Only a completed BOQ or RFQ can be continued to the next step.");
      }
      if (targetType !== nextRequestType(source.type)) {
        return fail("INVALID_STATE", "The flow is BOQ, then RFQ, then PO: a BOQ continues as an RFQ and an RFQ as a PO.");
      }
      const again = await tx.request.findUnique({
        where: { sourceRequestId_type: { sourceRequestId: source.id, type: targetType } },
        select: { id: true, code: true },
      });
      if (again) return succeed({ ...again, created: false });
      if (source.project.trackStatus !== "ON_TRACK") return fail("PROJECT_NOT_ACTIVE");

      const code = await nextRequestCode(tx, targetType, actor.email, new Date());
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
    if (!source || source.project.deletedAt) return fail("NOT_FOUND", "Request not found.");
    if (!canContinueFlow(actor.role, source.type, salesActsOn(source.project, actor.id))) return fail("FORBIDDEN");
    if (!canHandOver(source.type, source.status)) return fail("INVALID_STATE", "Only a completed BOQ or RFQ has a next step to decide on.");
    if (source.handovers.length > 0) return fail("INVALID_STATE", "This request has already been continued.");

    await tx.request.update({ where: { id: source.id }, data: { flowStoppedAt: new Date(), flowStoppedById: actor.id, flowStoppedNote: note } });
    await audit(tx, actor.id, "request", "request.flow_stopped", source.id, null, { code: source.code, note });
    const next = nextRequestType(source.type)!;
    await notify(tx, {
      actorId: actor.id,
      recipientIds: [source.requesterId, source.project.salesOwnerId, ...(source.assigneeId ? [source.assigneeId] : [])],
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
    if (!request) return fail("NOT_FOUND", "Request not found.");
    const project = await tx.project.findUnique({ where: { id: request.projectId }, select: { salesOwnerId: true, sourceType: true } });
    // The Sales owner answers a request that waits for Sales: back to In progress with the answer, or cancel it. Nothing else.
    const salesResponding =
      actor.role === "SALES" && project !== null && salesActsOn(project, actor.id) && request.status === "WAITING_FOR_SALES" && (to === "IN_PROGRESS" || to === "CANCELLED");
    if (!can(actor.role, workPermission(request.type)) && !salesResponding) return fail("FORBIDDEN");
    if (salesResponding && !reason) return fail("INVALID_INPUT", "Write your answer or the reason for cancelling.");

    if (!canTransition(request.status, to)) {
      const options = allowedTransitions(request.status).map((s) => REQUEST_STATUS_LABELS[s]);
      return fail(
        "INVALID_STATE",
        `A ${REQUEST_STATUS_LABELS[request.status]} request cannot become ${REQUEST_STATUS_LABELS[to]}.` +
          (options.length > 0 ? ` Allowed: ${options.join(", ")}.` : " It is final."),
      );
    }
    if (reasonRequired(request.status, to) && !reason) return fail("INVALID_INPUT", "Give a reason for this change.");

    const now = new Date();
    await tx.request.update({
      where: { id: request.id },
      data: {
        status: to,
        completedAt: to === "COMPLETED" ? now : null,
        // Whoever first starts the work owns it, so "unassigned" does not linger on active requests.
        assigneeId: request.assigneeId ?? (can(actor.role, workPermission(request.type)) ? actor.id : null),
      },
    });
    await tx.requestStatusHistory.create({
      data: { requestId: request.id, fromStatus: request.status, toStatus: to, changedById: actor.id, changedAt: now, reason },
    });
    await audit(tx, actor.id, "request", "request.status_changed", request.id, { status: request.status }, { status: to, reason });
    const team = salesResponding ? (request.assigneeId ? [request.assigneeId] : await usersWithRole(tx, OWNING_ROLE[request.type])) : [];
    await notify(tx, {
      actorId: actor.id,
      recipientIds: [request.requesterId, ...(project ? [project.salesOwnerId] : []), ...team],
      kind: "request.status_changed",
      title: to === "WAITING_FOR_SALES" ? `${request.code} needs your input` : salesResponding && to === "IN_PROGRESS" ? `${request.code}: Sales answered` : `${request.code} is now ${REQUEST_STATUS_LABELS[to]}`,
      body: reason,
      href: `/request/${request.code}`,
    });
    return succeed({ code: request.code, status: to });
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
    if (!request) return fail("NOT_FOUND", "Request not found.");
    if (request.type !== "BOQ") return fail("INVALID_STATE", "Only a BOQ request has an SOA phase.");
    if (request.status === "COMPLETED" || request.status === "CANCELLED") return fail("INVALID_STATE", "This request is already closed.");
    if (request.phase === phase) return succeed({ code: request.code });

    // Labelling the work with a phase means SOA has started it: a request nobody had touched goes to In progress by itself.
    const starts = phase !== null && request.status === "SUBMITTED";
    await tx.request.update({
      where: { id: request.id },
      data: { phase, ...(starts ? { status: "IN_PROGRESS" as const } : {}), assigneeId: request.assigneeId ?? actor.id },
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
