import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/domain/access/roles";
import { SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND } from "@/domain/notifications/kinds";
import { SLA_ALERT_KIND, slaAlertKey, slaAlertLevel, slaAlertText, slaRoundStart } from "@/domain/notifications/sla-alerts";
import { slaOf } from "@/domain/requests/sla";
import { OWNING_ROLE } from "@/domain/requests/types";
import { getTeamSetting } from "@/server/settings/team-settings";

/** Who is told besides the team that works the request, when a deadline has passed (D-083): the people who can step in. */
const ESCALATION_ROLES: readonly Role[] = ["ADMIN", "MANAGEMENT"];

export type SlaScanResult = {
  /** Open requests looked at. */
  checked: number;
  warnings: number;
  dangers: number;
  /** Alerts of requests that are finished or deleted, marked as read. */
  closed: number;
};

/**
 * The scheduled scan (D-083). A deadline passing is not an event anybody causes, so a cron job on the server calls this on working
 * days: it works out the SLA state of every open BOQ, RFQ and PO with `slaOf` (the rule behind the badge) and writes one alert per
 * recipient, request, SLA round and level. Warnings go to the team that works the request (SOA for a BOQ, Purchasing for an RFQ or a
 * PO); dangers go to the team and to Admin and Management. Running it again finds the rows it wrote and adds nothing. No person is the
 * actor, so nobody is left out. A deadline that passed more than `SLA_ALERT_MAX_AGE_DAYS` ago is not alerted (no flood on the first scan).
 * Alerts of finished or deleted requests are marked as read.
 */
export async function scanSlaAlerts(db: PrismaClient, now: Date = new Date()): Promise<SlaScanResult> {
  const [soa, purchasing] = await Promise.all([getTeamSetting(db, "SOA"), getTeamSetting(db, "PURCHASING")]);
  const ranges = { SOA: soa.sla, PURCHASING: purchasing.sla } as const;

  const [requests, users] = await Promise.all([
    db.request.findMany({
      where: { deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] }, project: { deletedAt: null } },
      select: {
        id: true,
        code: true,
        type: true,
        title: true,
        status: true,
        createdAt: true,
        completedAt: true,
        pic: { select: { name: true } },
        statusHistory: { select: { toStatus: true, changedAt: true } },
      },
    }),
    db.user.findMany({ where: { isActive: true, role: { in: ["SOA", "PURCHASING", ...ESCALATION_ROLES] } }, select: { id: true, role: true } }),
  ]);
  const idsOf = (...roles: Role[]) => users.filter((user) => roles.includes(user.role)).map((user) => user.id);

  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const request of requests) {
    const team = OWNING_ROLE[request.type] as "SOA" | "PURCHASING";
    const sla = slaOf({ createdAt: request.createdAt, status: request.status, completedAt: request.completedAt, history: request.statusHistory, range: ranges[team], now });
    const level = slaAlertLevel(sla, now);
    if (!level) continue;

    const recipients = level === "DANGER" ? idsOf(team, ...ESCALATION_ROLES) : idsOf(team);
    const dedupeKey = slaAlertKey(request.id, slaRoundStart(request.createdAt, sla, request.status), level);
    const text = slaAlertText({ code: request.code, type: request.type, level, dueAt: sla.dueAt, now, revision: request.status === "REVISION", picName: request.pic?.name ?? null, title: request.title });
    for (const recipientId of recipients) {
      rows.push({ recipientId, kind: SLA_ALERT_KIND[level], severity: level, title: text.title.slice(0, 200), body: text.body.slice(0, 300), href: `/request/${request.code}`, requestId: request.id, dedupeKey });
    }
  }

  // One statement for the whole scan; rows that already exist (same recipient and dedupe key) are skipped by the unique index.
  const result: SlaScanResult = { checked: requests.length, warnings: 0, dangers: 0, closed: 0 };
  if (rows.length > 0) {
    const existing = new Set(
      (await db.notification.findMany({ where: { dedupeKey: { in: [...new Set(rows.map((row) => row.dedupeKey!))] } }, select: { recipientId: true, dedupeKey: true } })).map((row) => `${row.recipientId}|${row.dedupeKey}`),
    );
    const fresh = rows.filter((row) => !existing.has(`${row.recipientId}|${row.dedupeKey}`));
    if (fresh.length > 0) await db.notification.createMany({ data: fresh, skipDuplicates: true });
    result.warnings = fresh.filter((row) => row.severity === "WARNING").length;
    result.dangers = fresh.filter((row) => row.severity === "DANGER").length;
  }
  result.closed = await closeFinishedAlerts(db);
  return result;
}

/** Unread SLA alerts whose request is completed, cancelled or deleted (or gone): read. A request in Revision keeps its alerts of the round it is in. */
async function closeFinishedAlerts(db: PrismaClient): Promise<number> {
  const unread = await db.notification.findMany({
    where: { kind: { in: [SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND] }, readAt: null, requestId: { not: null } },
    select: { requestId: true },
    distinct: ["requestId"],
  });
  const ids = unread.map((row) => row.requestId).filter((id): id is string => id !== null);
  if (ids.length === 0) return 0;
  const live = await db.request.findMany({
    where: { id: { in: ids }, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] }, project: { deletedAt: null } },
    select: { id: true },
  });
  const liveIds = new Set(live.map((row) => row.id));
  const finished = ids.filter((id) => !liveIds.has(id));
  if (finished.length === 0) return 0;
  const closed = await db.notification.updateMany({ where: { requestId: { in: finished }, kind: { in: [SLA_DUE_SOON_KIND, SLA_OVERDUE_KIND] }, readAt: null }, data: { readAt: new Date() } });
  return closed.count;
}
