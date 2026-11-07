import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/domain/access/roles";
import { SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND } from "@/domain/notifications/kinds";
import { defaultSeverityFor, NOTIFICATION_SEVERITIES, type NotificationSeverity, type UnreadBySeverity } from "@/domain/notifications/severity";
import { isOpen } from "@/domain/requests/status";
import { OWNING_ROLE } from "@/domain/requests/types";

type Tx = Prisma.TransactionClient;

export type NotificationInput = {
  /** The person who made the change; never notified about their own action. */
  actorId: string;
  /** A null entry (a project with no Sales PIC) is skipped. */
  recipientIds: Iterable<string | null>;
  kind: string;
  /** Left out, the level follows the kind: a revision is Danger, everything else Info. */
  severity?: NotificationSeverity;
  title: string;
  body?: string | null;
  /** A path inside the application. */
  href: string;
};

/** Writes one notification per recipient, inside the caller's transaction. Returns how many were written. */
export async function notify(tx: Tx, input: NotificationInput): Promise<number> {
  const recipients = [...new Set(input.recipientIds)].filter((id): id is string => id !== null && id !== input.actorId);
  if (recipients.length === 0) return 0;
  const body = input.body?.trim() ? input.body.trim().slice(0, 300) : null;
  const severity = input.severity ?? defaultSeverityFor(input.kind);
  await tx.notification.createMany({
    data: recipients.map((recipientId) => ({ recipientId, kind: input.kind, severity, title: input.title.slice(0, 200), body, href: input.href })),
  });
  return recipients.length;
}

/** Active users who have one of the roles (a team's inbox). */
export async function usersWithRole(tx: Tx, ...roles: Role[]): Promise<string[]> {
  const users = await tx.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
  return users.map((user) => user.id);
}

/**
 * Everyone who should hear about a change to a project: its Sales owner, its technical PIC, and the team that has
 * an open request on it (SOA for a BOQ, Purchasing for an RFQ or a PO). The actor is removed by `notify`.
 */
export async function projectAudience(tx: Tx, projectId: string): Promise<string[]> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { salesOwnerId: true, technicalPicId: true, purchasingPicId: true, requests: { where: { deletedAt: null }, select: { type: true, status: true } } },
  });
  if (!project) return [];
  const ids = new Set<string>();
  if (project.salesOwnerId) ids.add(project.salesOwnerId);
  if (project.technicalPicId) ids.add(project.technicalPicId);
  if (project.purchasingPicId) ids.add(project.purchasingPicId);
  const teams = new Set<Role>(project.requests.filter((request) => isOpen(request.status)).map((request) => OWNING_ROLE[request.type]));
  if (teams.size > 0) for (const id of await usersWithRole(tx, ...teams)) ids.add(id);
  return [...ids];
}

export type NotificationRow = {
  id: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  href: string;
  createdAt: Date;
  readAt: Date | null;
};

const LIST_LIMIT = 100;

/** A user's own notifications, newest first, all levels or one. Nobody can read another user's. */
export async function listNotifications(db: PrismaClient, userId: string, severity?: NotificationSeverity): Promise<NotificationRow[]> {
  return db.notification.findMany({
    where: { recipientId: userId, ...(severity ? { severity } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
    select: { id: true, kind: true, severity: true, title: true, body: true, href: true, createdAt: true, readAt: true },
  });
}

/** How many unread notifications the user has at each level. */
export async function countUnreadBySeverity(db: PrismaClient, userId: string): Promise<UnreadBySeverity> {
  const groups = await db.notification.groupBy({ by: ["severity"], where: { recipientId: userId, readAt: null }, _count: { _all: true } });
  const counts: UnreadBySeverity = { INFO: 0, WARNING: 0, DANGER: 0 };
  for (const severity of NOTIFICATION_SEVERITIES) counts[severity] = groups.find((group) => group.severity === severity)?._count._all ?? 0;
  return counts;
}

export async function countUnread(db: PrismaClient, userId: string): Promise<number> {
  return db.notification.count({ where: { recipientId: userId, readAt: null } });
}

/** Marks one of the user's own notifications as read; someone else's id changes nothing. */
export async function markRead(db: PrismaClient, userId: string, id: string): Promise<void> {
  await db.notification.updateMany({ where: { id, recipientId: userId, readAt: null }, data: { readAt: new Date() } });
}

/** Marks the user's unread notifications as read: all of them, or only those of one level (the tab the person is on). */
export async function markAllRead(db: PrismaClient, userId: string, severity?: NotificationSeverity): Promise<number> {
  const result = await db.notification.updateMany({ where: { recipientId: userId, readAt: null, ...(severity ? { severity } : {}) }, data: { readAt: new Date() } });
  return result.count;
}

/** The request is finished (completed or cancelled): its SLA alerts no longer ask for anything, so they are read for every recipient. */
export async function closeSlaAlerts(tx: Tx, requestId: string): Promise<number> {
  const result = await tx.notification.updateMany({ where: { requestId, kind: { in: [SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND] }, readAt: null }, data: { readAt: new Date() } });
  return result.count;
}
