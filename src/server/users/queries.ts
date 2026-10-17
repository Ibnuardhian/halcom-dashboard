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
