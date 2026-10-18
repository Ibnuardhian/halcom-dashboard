import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import { ROLES, type Role } from "@/domain/access/roles";
import type { Actor } from "./service";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
};

function assertPermitted(allowed: boolean): void {
  // Pages and actions check permissions first; this guards against a missed check.
  if (!allowed) throw new Error("Forbidden: missing permission for this query.");
}

export async function listUsers(db: PrismaClient, actor: Actor): Promise<UserRow[]> {
  assertPermitted(can(actor.role, "users.view"));
  return db.user.findMany({
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}

export type UserStats = {
  total: number;
  active: number;
  byRole: Record<Role, { active: number; inactive: number }>;
};

export async function getUserStats(db: PrismaClient, actor: Actor): Promise<UserStats> {
  assertPermitted(can(actor.role, "users.view"));
  const groups = await db.user.groupBy({ by: ["role", "isActive"], _count: { _all: true } });
  const byRole = Object.fromEntries(ROLES.map((role) => [role, { active: 0, inactive: 0 }])) as UserStats["byRole"];
  for (const group of groups) {
    byRole[group.role][group.isActive ? "active" : "inactive"] = group._count._all;
  }
  const active = ROLES.reduce((sum, role) => sum + byRole[role].active, 0);
  const inactive = ROLES.reduce((sum, role) => sum + byRole[role].inactive, 0);
  return { total: active + inactive, active, byRole };
}

/** Audit events of the last `days` days other than sign-ins and sign-outs: accounts, settings, master data, projects and exports. */
export async function countAdministrativeChanges(db: PrismaClient, actor: Actor, days: number): Promise<number> {
  assertPermitted(can(actor.role, "audit.view"));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db.auditEvent.count({ where: { createdAt: { gte: since }, NOT: { action: { startsWith: "auth." } } } });
}

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  createdAt: Date;
};

export async function recentAuditEvents(db: PrismaClient, actor: Actor, limit = 10): Promise<AuditRow[]> {
  assertPermitted(can(actor.role, "audit.view"));
  const events = await db.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true } } },
  });
  return events.map((event) => ({
    id: event.id,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    actorName: event.actor?.name ?? null,
    createdAt: event.createdAt,
  }));
}

export type AuditLogRow = AuditRow & { summary: string };

const AUDIT_PAGE_SIZE = 200;
const SUMMARY_LIMIT = 160;

function summarise(before: unknown, after: unknown): string {
  const text = [before, after]
    .map((value) => (value === null || value === undefined ? null : JSON.stringify(value)))
    .filter((value): value is string => value !== null && value !== "null")
    .join(" → ");
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1)}…` : text;
}

/** The audit trail, newest first, optionally narrowed to one kind of entity. Payloads never hold passwords by design. */
export async function listAuditEvents(
  db: PrismaClient,
  actor: Actor,
  filter: { entityType?: string } = {},
): Promise<AuditLogRow[]> {
  assertPermitted(can(actor.role, "audit.view"));
  const events = await db.auditEvent.findMany({
    where: filter.entityType ? { entityType: filter.entityType } : undefined,
    orderBy: { createdAt: "desc" },
    take: AUDIT_PAGE_SIZE,
    include: { actor: { select: { name: true } } },
  });
  return events.map((event) => ({
    id: event.id,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    actorName: event.actor?.name ?? null,
    createdAt: event.createdAt,
    summary: summarise(event.before, event.after),
  }));
}

export async function listAuditEntityTypes(db: PrismaClient, actor: Actor): Promise<string[]> {
  assertPermitted(can(actor.role, "audit.view"));
  const groups = await db.auditEvent.groupBy({ by: ["entityType"], orderBy: { entityType: "asc" } });
  return groups.map((group) => group.entityType);
}
