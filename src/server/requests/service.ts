import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { allowedTransitions, canHandOver, canTransition, reasonRequired, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { workPermission } from "@/domain/requests/access";
import { nextProjectCode, nextRequestCode } from "./codes";
import { ensureCustomer } from "./master-data";
import { createProjectSchema, createRequestSchema, handoverSchema, statusChangeSchema } from "./schemas";

export type Actor = { id: string; role: Role };

const ERROR_MESSAGES = {
  FORBIDDEN: "You are not allowed to do that.",
  NOT_FOUND: "The record was not found.",
  INVALID_INPUT: "The submitted data is invalid.",
  INVALID_STATE: "This is not possible in the current status.",
  PROJECT_NOT_ACTIVE: "Requests can only be added to an active project.",
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

export async function createProject(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<WorkResult<CreatedRecord>> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "projects.create")) return fail("FORBIDDEN");
  const { endUserCompany, name, description, targetDate, submissionKey } = parsed.data;

  const existing = () => db.project.findUnique({ where: { submissionKey: submissionKey! }, select: { id: true, code: true } });
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "projects.create")) return fail("FORBIDDEN");
      if (submissionKey) {
        const again = await tx.project.findUnique({ where: { submissionKey }, select: { id: true, code: true } });
        if (again) return succeed({ ...again, created: false });
      }

      const code = await nextProjectCode(tx);
      const customerId = await ensureCustomer(tx, endUserCompany);
      const project = await tx.project.create({
        data: { code, endUserCompany, name, description, targetDate, salesOwnerId: actor.id, customerId, submissionKey },
      });
      await audit(tx, actor.id, "project", "project.created", project.id, null, { code, endUserCompany, name });
      return succeed({ id: project.id, code, created: true });
    });
  } catch (error) {
    // A concurrent submit with the same key won the race: return its project.
    if (submissionKey && isUniqueViolation(error)) {
      const winner = await existing();
      if (winner) return succeed({ ...winner, created: false });
    }
    throw error;
  }
}

export async function createRequest(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<WorkResult<CreatedRecord>> {
  const parsed = createRequestSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "requests.create")) return fail("FORBIDDEN");
  const { projectId, type, title, description, requiredBy, submissionKey } = parsed.data;

  const existing = () => db.request.findUnique({ where: { submissionKey: submissionKey! }, select: { id: true, code: true } });
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "requests.create")) return fail("FORBIDDEN");
      if (submissionKey) {
        const again = await tx.request.findUnique({ where: { submissionKey }, select: { id: true, code: true } });
        if (again) return succeed({ ...again, created: false });
      }
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, status: true } });
      if (!project) return fail("NOT_FOUND", "Project not found.");
      if (project.status !== "ACTIVE") return fail("PROJECT_NOT_ACTIVE");

      const code = await nextRequestCode(tx, type, actor.email, new Date());
      const request = await tx.request.create({
        data: { code, type, projectId, title, description: description ?? "", requiredBy, requesterId: actor.id, submissionKey },
      });
      await tx.requestStatusHistory.create({
        data: { requestId: request.id, fromStatus: null, toStatus: "SUBMITTED", changedById: actor.id },
      });
      await audit(tx, actor.id, "request", "request.created", request.id, null, { code, type, projectId });
      return succeed({ id: request.id, code, created: true });
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
 * SOA hands a completed BOQ over to Purchasing as an RFQ or a PO (brief §6.1). The actor chooses
 * the type; completing a BOQ never implies a purchase. Idempotent: the database allows one request
 * of each type per source BOQ, so a repeated click returns the request that already exists.
 */
export async function handOverToPurchasing(
  db: PrismaClient,
  claimedActor: Actor,
  input: unknown,
): Promise<WorkResult<CreatedRecord>> {
  const parsed = handoverSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message);
  if (!can(claimedActor.role, "requests.handover")) return fail("FORBIDDEN");
  const { sourceId, targetType } = parsed.data;

  const existing = () =>
    db.request.findUnique({
      where: { sourceRequestId_type: { sourceRequestId: sourceId, type: targetType } },
      select: { id: true, code: true },
    });
  try {
    return await db.$transaction(async (tx) => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "requests.handover")) return fail("FORBIDDEN");

      await tx.$executeRaw`SELECT id FROM requests WHERE id = ${sourceId}::uuid FOR UPDATE`;
      const source = await tx.request.findUnique({ where: { id: sourceId }, include: { project: { select: { status: true } } } });
      if (!source) return fail("NOT_FOUND", "BOQ request not found.");
      if (!canHandOver(source.type, source.status)) {
        return fail("INVALID_STATE", "Only a completed BOQ can be handed over to Purchasing.");
      }
      const again = await tx.request.findUnique({
        where: { sourceRequestId_type: { sourceRequestId: source.id, type: targetType } },
        select: { id: true, code: true },
      });
      if (again) return succeed({ ...again, created: false });
      if (source.project.status !== "ACTIVE") return fail("PROJECT_NOT_ACTIVE");

      const code = await nextRequestCode(tx, targetType, actor.email, new Date());
      const request = await tx.request.create({
        data: {
          code,
          type: targetType,
          projectId: source.projectId,
          title: source.title,
          description: source.description,
          requiredBy: source.requiredBy,
          requesterId: actor.id,
          sourceRequestId: source.id,
        },
      });
      await tx.requestStatusHistory.create({
        data: { requestId: request.id, fromStatus: null, toStatus: "SUBMITTED", changedById: actor.id, reason: `Handed over from ${source.code}` },
      });
      await audit(tx, actor.id, "request", "request.handed_over", request.id, null, {
        code,
        type: targetType,
        sourceId: source.id,
        sourceCode: source.code,
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
    if (!can(actor.role, workPermission(request.type))) return fail("FORBIDDEN");

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
        assigneeId: request.assigneeId ?? (to === "IN_PROGRESS" ? actor.id : null),
      },
    });
    await tx.requestStatusHistory.create({
      data: { requestId: request.id, fromStatus: request.status, toStatus: to, changedById: actor.id, changedAt: now, reason },
    });
    await audit(tx, actor.id, "request", "request.status_changed", request.id, { status: request.status }, { status: to, reason });
    return succeed({ code: request.code, status: to });
  });
}
