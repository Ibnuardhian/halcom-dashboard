import type { NotificationSeverity } from "@/domain/notifications/severity";
import type { TeamMetrics } from "@/domain/requests/metrics";

/**
 * What the Management dashboard puts at the top: the things a team or the whole company should look at, ranked Danger, Warning, Info
 * with the same words and colours as the notifications (D-083). Each is a rule over numbers the dashboards already show, with a link
 * to the list behind it, so a concern can always be checked. The thresholds are plain constants here, not settings: changing one is a
 * code change with a test (D-085).
 */

/** An open request still Submitted for longer than this (calendar hours) means nobody picked it up. */
export const BACKLOG_STALE_HOURS = 72;
/** SLA compliance under the first number is a Warning, under the second a Danger (completed requests of the last 90 days). */
export const SLA_COMPLIANCE_WARNING_PCT = 90;
export const SLA_COMPLIANCE_DANGER_PCT = 70;
/** One PIC holding this many open requests or more is overloaded. */
export const PIC_OPEN_LIMIT = 8;
/** A completed BOQ nobody decided on for longer than this (calendar days) is stuck between SOA and Purchasing. */
export const HANDOFF_STALE_DAYS = 3;
/** An open project nobody touched for this many days needs a follow-up; this many of them is a Warning rather than Info. */
export const PROJECT_STALE_DAYS = 30;
export const STALE_PROJECTS_WARNING = 5;

export type ConcernArea = "SOA" | "Purchasing" | "Sales" | "Finance" | "Lintas tim";

export type Concern = {
  key: string;
  severity: NotificationSeverity;
  area: ConcernArea;
  title: string;
  detail: string;
  /** Where the numbers behind it are listed; null when no list exists. */
  href: string | null;
};

export type TeamConcernInput = {
  area: "SOA" | "Purchasing";
  metrics: TeamMetrics;
  /** The list of this team's requests, ending in `?` or `&`, so a query can be added. */
  base: string;
};

export type ManagementInput = {
  teams: readonly TeamConcernInput[];
  /** Completed BOQs nobody decided on, and how long the oldest has waited (null when none). */
  awaitingHandoff: { count: number; oldestDays: number | null; href: string };
  staleProjects: { count: number; href: string };
  /** Projects Finance has flagged (null when the viewer may not read the crosscheck). */
  financeFlagged: { count: number; href: string } | null;
};

const RANK: Record<NotificationSeverity, number> = { DANGER: 0, WARNING: 1, INFO: 2 };

const requests = (count: number) => `${count} request`;

function teamConcerns({ area, metrics, base }: TeamConcernInput): Concern[] {
  const found: Concern[] = [];
  const add = (concern: Omit<Concern, "area" | "key"> & { key: string }) => found.push({ ...concern, key: `${area}:${concern.key}`, area });

  if (metrics.overdue > 0) {
    add({ key: "overdue", severity: "DANGER", title: `${requests(metrics.overdue)} melewati batas SLA`, detail: "Masih terbuka dan sudah lewat batas waktu. Tim sudah mendapat notifikasi Danger.", href: `${base}sla=overdue` });
  }
  if (metrics.dueNow > 0) {
    add({ key: "due-now", severity: "WARNING", title: `${requests(metrics.dueNow)} mendekati batas SLA`, detail: "Antara tanggal yang diharapkan dan batas waktu.", href: `${base}sla=due_soon` });
  }
  const submitted = metrics.bottlenecks.find((row) => row.status === "SUBMITTED");
  if (submitted && submitted.oldestHours > BACKLOG_STALE_HOURS) {
    add({
      key: "backlog",
      severity: "WARNING",
      title: `${requests(submitted.count)} belum dimulai`,
      detail: `Yang terlama, ${submitted.oldestCode}, menunggu lebih dari ${Math.floor(submitted.oldestHours / 24)} hari di Submitted.`,
      href: `${base}status=SUBMITTED`,
    });
  }
  if (metrics.unassigned > 0) {
    add({ key: "unassigned", severity: "WARNING", title: `${requests(metrics.unassigned)} tanpa PIC`, detail: "Terbuka, tetapi belum diserahkan ke PIC mana pun.", href: `${base}assignee=none&status=open` });
  }
  for (const row of metrics.workload) {
    if (row.assigneeId !== null && row.open >= PIC_OPEN_LIMIT) {
      add({ key: `pic:${row.assigneeId}`, severity: "WARNING", title: `${row.name} memegang ${row.open} request terbuka`, detail: `Batas wajar ${PIC_OPEN_LIMIT}; ${row.overdue} di antaranya overdue.`, href: `${base}assignee=${row.assigneeId}&status=open` });
    }
  }
  if (metrics.pastNeededBy > 0) {
    add({ key: "needed-by", severity: "WARNING", title: `${requests(metrics.pastNeededBy)} melewati tanggal dibutuhkan`, detail: "Masih terbuka, dan tanggal yang diminta Sales sudah lewat.", href: `${base}deadline=past` });
  }
  const pct = metrics.slaCompliancePct;
  if (pct !== null && pct < SLA_COMPLIANCE_WARNING_PCT) {
    add({
      key: "compliance",
      severity: pct < SLA_COMPLIANCE_DANGER_PCT ? "DANGER" : "WARNING",
      title: `Kepatuhan SLA ${Math.round(pct)}%`,
      detail: `${metrics.slaLate} dari ${metrics.slaMet + metrics.slaLate} request yang selesai dalam 90 hari terakhir terlambat. Target ${SLA_COMPLIANCE_WARNING_PCT}%.`,
      href: null,
    });
  }
  return found;
}

/** Every concern of the moment, loudest first; within a level, the teams' own concerns in the order of the rules. */
export function computeConcerns(input: ManagementInput): Concern[] {
  const found: Concern[] = input.teams.flatMap(teamConcerns);

  const { awaitingHandoff, staleProjects, financeFlagged } = input;
  if (awaitingHandoff.count > 0) {
    const stuck = awaitingHandoff.oldestDays !== null && awaitingHandoff.oldestDays > HANDOFF_STALE_DAYS;
    found.push({
      key: "handoff",
      severity: stuck ? "WARNING" : "INFO",
      area: "Lintas tim",
      title: `${awaitingHandoff.count} BOQ selesai belum dilanjutkan`,
      detail: stuck ? `Yang terlama menunggu keputusan Sales ${awaitingHandoff.oldestDays} hari: RFQ belum dibuat atau alur belum dihentikan.` : "Menunggu keputusan Sales: lanjut ke RFQ atau hentikan.",
      href: awaitingHandoff.href,
    });
  }
  if (staleProjects.count > 0) {
    found.push({
      key: "stale-projects",
      severity: staleProjects.count >= STALE_PROJECTS_WARNING ? "WARNING" : "INFO",
      area: "Sales",
      title: `${staleProjects.count} project terbuka tidak diperbarui lebih dari ${PROJECT_STALE_DAYS} hari`,
      detail: "Tidak ada perubahan, aksi, atau request baru. Perlu ditindaklanjuti oleh Sales PIC-nya.",
      href: staleProjects.href,
    });
  }
  if (financeFlagged && financeFlagged.count > 0) {
    found.push({ key: "finance", severity: "WARNING", area: "Finance", title: `${financeFlagged.count} project perlu dicek Finance`, detail: "Selisih antara quotation, PO, dan nilai project pada crosscheck.", href: financeFlagged.href });
  }
  return found.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** Counts of the concerns per level, for the summary line. */
export function countBySeverity(concerns: readonly Concern[]): Record<NotificationSeverity, number> {
  const counts: Record<NotificationSeverity, number> = { INFO: 0, WARNING: 0, DANGER: 0 };
  for (const concern of concerns) counts[concern.severity] += 1;
  return counts;
}
