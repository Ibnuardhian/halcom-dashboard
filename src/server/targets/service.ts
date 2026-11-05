import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { parseAmount } from "@/domain/projects/commercial";
import { MONTHS, MONTH_NAMES, QUARTERS, quarterOfMonth, summariseTargets, type Quarter, type TargetSummary } from "@/domain/targets/quarters";

type Viewer = { id: string; role: Role };

/**
 * The gross-profit picture of one calendar year (revenue figures are still computed but no longer shown): the targets entered, what was won and what the open pipeline
 * is expected to bring, per quarter and per month. `salesOwnerId` narrows it to one salesperson; without it every Sales person's
 * projects and targets are added together.
 */
export async function getTargetSummary(db: PrismaClient, viewer: Viewer, options: { year: number; salesOwnerId?: string }): Promise<TargetSummary> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const owner = options.salesOwnerId ? { salesOwnerId: options.salesOwnerId } : {};
  const targetOwner = options.salesOwnerId ? { salesUserId: options.salesOwnerId } : {};
  const [projects, targets, monthRows] = await Promise.all([
    db.project.findMany({
      where: { ...owner, deletedAt: null },
      select: { progress: true, trackStatus: true, estimatedValue: true, finalValue: true, targetMargin: true, targetMarginValue: true, wonDate: true, targetDate: true },
    }),
    db.salesTarget.findMany({ where: { year: options.year, ...targetOwner } }),
    db.salesTargetMonth.findMany({ where: { year: options.year, ...targetOwner } }),
  ]);

  // Several salespeople's targets for one quarter or month are added up; one salesperson has at most one row each.
  const merged = new Map<Quarter, { revenueTarget: number | null; grossProfitTarget: number | null }>();
  for (const row of targets) {
    const quarter = row.quarter as Quarter;
    const current = merged.get(quarter) ?? { revenueTarget: null, grossProfitTarget: null };
    const add = (a: number | null, b: { toNumber(): number } | null) => (b === null ? a : (a ?? 0) + b.toNumber());
    merged.set(quarter, { revenueTarget: add(current.revenueTarget, row.revenueTarget), grossProfitTarget: add(current.grossProfitTarget, row.grossProfitTarget) });
  }
  const monthTotals = new Map<number, number>();
  for (const row of monthRows) monthTotals.set(row.month, (monthTotals.get(row.month) ?? 0) + row.grossProfitTarget.toNumber());

  return summariseTargets(
    options.year,
    projects.map((project) => ({
      progress: project.progress,
      trackStatus: project.trackStatus,
      estimatedValue: project.estimatedValue?.toNumber() ?? null,
      finalValue: project.finalValue?.toNumber() ?? null,
      targetMargin: project.targetMargin?.toNumber() ?? null,
      targetMarginValue: project.targetMarginValue?.toNumber() ?? null,
      wonDate: project.wonDate,
      targetDate: project.targetDate,
    })),
    [...merged].map(([quarter, values]) => ({ quarter, ...values })),
    [...monthTotals].map(([month, grossProfitTarget]) => ({ month, grossProfitTarget })),
  );
}

export type StoredTargets = {
  months: Record<number, number | null>;
  /** The quarter targets as stored: for a year entered by quarter, before months existed, these hold the only target. */
  quarters: Record<Quarter, number | null>;
};

/** One salesperson's own gross-profit targets for a year, for the form. */
export async function getOwnTargets(db: PrismaClient, viewer: Viewer, year: number): Promise<StoredTargets> {
  if (!can(viewer.role, "targets.edit")) throw new Error("Forbidden: missing permission for this query.");
  const [quarterRows, monthRows] = await Promise.all([
    db.salesTarget.findMany({ where: { salesUserId: viewer.id, year } }),
    db.salesTargetMonth.findMany({ where: { salesUserId: viewer.id, year } }),
  ]);
  const months = Object.fromEntries(MONTHS.map((m) => [m, null])) as StoredTargets["months"];
  const quarters = Object.fromEntries(QUARTERS.map((q) => [q, null])) as StoredTargets["quarters"];
  for (const row of monthRows) months[row.month] = row.grossProfitTarget.toNumber();
  for (const row of quarterRows) quarters[row.quarter as Quarter] = row.grossProfitTarget?.toNumber() ?? null;
  return { months, quarters };
}

export type SalesBreakdownRow = { id: string; name: string; target: number | null; won: number; wonCount: number };

/** Every salesperson's target and won gross profit for a year. Only people who see the whole team may ask (a salesperson sees only their own page). */
export async function getSalesBreakdown(db: PrismaClient, viewer: Viewer, year: number): Promise<SalesBreakdownRow[]> {
  if (!can(viewer.role, "projects.view") || viewer.role === "SALES") throw new Error("Forbidden: missing permission for this query.");
  const people = await db.user.findMany({
    where: {
      role: "SALES",
      OR: [
        { isActive: true },
        { salesTargets: { some: { year } } },
        { ownedProjects: { some: { progress: "CLOSED_WON", deletedAt: null, wonDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } } },
      ],
    },
    select: { id: true, name: true },
  });
  const rows = await Promise.all(
    people.map(async (person) => {
      const summary = await getTargetSummary(db, viewer, { year, salesOwnerId: person.id });
      return { id: person.id, name: person.name, target: summary.total.grossProfit.target, won: summary.total.grossProfit.won, wonCount: summary.wonCount };
    }),
  );
  return rows.sort((a, b) => b.won - a.won || a.name.localeCompare(b.name));
}

/** The years worth showing: every year that has a target or a won project, plus this year and the next (where targets are set up). */
export async function getTargetYears(db: PrismaClient, viewer: Viewer, options: { salesOwnerId?: string; thisYear: number }): Promise<number[]> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const owner = options.salesOwnerId;
  const [quarterYears, monthYears, wonDates] = await Promise.all([
    db.salesTarget.findMany({ where: owner ? { salesUserId: owner } : {}, select: { year: true }, distinct: ["year"] }),
    db.salesTargetMonth.findMany({ where: owner ? { salesUserId: owner } : {}, select: { year: true }, distinct: ["year"] }),
    db.project.findMany({ where: { progress: "CLOSED_WON", wonDate: { not: null }, deletedAt: null, ...(owner ? { salesOwnerId: owner } : {}) }, select: { wonDate: true }, distinct: ["wonDate"] }),
  ]);
  const years = new Set<number>([options.thisYear, options.thisYear + 1]);
  for (const row of [...quarterYears, ...monthYears]) years.add(row.year);
  for (const row of wonDates) years.add(row.wonDate!.getUTCFullYear());
  return [...years].filter((y) => y >= 2001 && y <= 2099).sort((a, b) => a - b);
}

const monthValues = z.object({ grossProfit: z.string().max(40).nullish() }).strict();

const saveSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  months: z.object(Object.fromEntries(MONTHS.map((m) => [m, monthValues]))).strict(),
});

export type SaveTargetsResult =
  | { ok: true; changed: number[] }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT"; message: string };

/**
 * Sales enter their own gross-profit target for the twelve months of a year (there is no revenue target). A blank box means "no target".
 * A quarter whose months changed is rewritten as the sum of its three months, so the quarter rows, and with them the annual target, never
 * disagree with the months; a quarter whose months did not change is left alone (a year entered by quarter before months existed keeps its
 * quarter targets until its months are filled in). A revenue target stored by an earlier version is never shown and never written. Only the
 * signed-in salesperson's own targets can be written, whoever is named in the request. The change and its audit event (who, which month,
 * from, to) commit together.
 */
export async function saveSalesTargets(db: PrismaClient, claimedActor: Viewer, input: unknown): Promise<SaveTargetsResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Target yang dikirim tidak valid." };
  if (!can(claimedActor.role, "targets.edit")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };
  const { year, months } = parsed.data;
  const monthsByNumber = months as Record<number, { grossProfit?: string | null }>;

  const wanted = new Map<number, number | null>();
  for (const month of MONTHS) {
    const grossProfit = parseAmount(`${MONTH_NAMES[month - 1]} gross profit target`, monthsByNumber[month]!.grossProfit);
    if (!grossProfit.ok) return { ok: false, code: "INVALID_INPUT", message: grossProfit.message };
    wanted.set(month, grossProfit.value);
  }

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "targets.edit")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." } satisfies SaveTargetsResult;

    const existing = await tx.salesTargetMonth.findMany({ where: { salesUserId: actor.id, year } });
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const changed: number[] = [];
    const touchedQuarters = new Set<Quarter>();
    for (const month of MONTHS) {
      const was = existing.find((r) => r.month === month)?.grossProfitTarget.toNumber() ?? null;
      const now = wanted.get(month)!;
      if (was === now) continue;
      changed.push(month);
      touchedQuarters.add(quarterOfMonth(month));
      before[MONTH_NAMES[month - 1]!] = { grossProfit: was };
      after[MONTH_NAMES[month - 1]!] = { grossProfit: now };
      const key = { salesUserId_year_month: { salesUserId: actor.id, year, month } };
      if (now === null) await tx.salesTargetMonth.delete({ where: key });
      else if (was === null) await tx.salesTargetMonth.create({ data: { salesUserId: actor.id, year, month, grossProfitTarget: now } });
      else await tx.salesTargetMonth.update({ where: key, data: { grossProfitTarget: now } });
    }

    for (const quarter of touchedQuarters) {
      const values = MONTHS.filter((m) => quarterOfMonth(m) === quarter).map((m) => wanted.get(m)!);
      const sum = values.every((v) => v === null) ? null : values.reduce<number>((total, v) => total + (v ?? 0), 0);
      const key = { salesUserId_year_quarter: { salesUserId: actor.id, year, quarter } };
      const row = await tx.salesTarget.findUnique({ where: key });
      if (sum === null && (row?.revenueTarget ?? null) === null) {
        await tx.salesTarget.deleteMany({ where: { salesUserId: actor.id, year, quarter } });
      } else if (row) {
        // Update, not upsert: an upsert proposes an insert first, and a row with no target at all breaks the table's check even when the update would not.
        await tx.salesTarget.update({ where: key, data: { grossProfitTarget: sum } });
      } else {
        await tx.salesTarget.create({ data: { salesUserId: actor.id, year, quarter, grossProfitTarget: sum } });
      }
    }

    if (changed.length > 0) {
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "targets.saved",
          entityType: "sales_target",
          entityId: `${actor.id}:${year}`,
          before: before as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
        },
      });
    }
    return { ok: true, changed } satisfies SaveTargetsResult;
  });
}
