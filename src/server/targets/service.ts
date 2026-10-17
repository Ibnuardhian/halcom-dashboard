import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { parseAmount } from "@/domain/projects/commercial";
import { QUARTERS, summariseTargets, type Quarter, type TargetSummary } from "@/domain/targets/quarters";

type Viewer = { id: string; role: Role };

/**
 * The revenue and gross-profit picture of one calendar year: the targets entered, what was won and what the open pipeline
 * is expected to bring, per quarter. `salesOwnerId` narrows it to one salesperson; without it every Sales person's
 * projects and targets are added together.
 */
export async function getTargetSummary(db: PrismaClient, viewer: Viewer, options: { year: number; salesOwnerId?: string }): Promise<TargetSummary> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const owner = options.salesOwnerId ? { salesOwnerId: options.salesOwnerId } : {};
  const [projects, targets] = await Promise.all([
    db.project.findMany({
      where: { ...owner, deletedAt: null },
      select: { progress: true, trackStatus: true, estimatedValue: true, finalValue: true, targetMargin: true, targetMarginValue: true, wonDate: true, targetDate: true },
    }),
    db.salesTarget.findMany({ where: { year: options.year, ...(options.salesOwnerId ? { salesUserId: options.salesOwnerId } : {}) } }),
  ]);

  // Several salespeople's targets for one quarter are added up; one salesperson has at most one row per quarter.
  const merged = new Map<Quarter, { revenueTarget: number | null; grossProfitTarget: number | null }>();
  for (const row of targets) {
    const quarter = row.quarter as Quarter;
    const current = merged.get(quarter) ?? { revenueTarget: null, grossProfitTarget: null };
    const add = (a: number | null, b: { toNumber(): number } | null) => (b === null ? a : (a ?? 0) + b.toNumber());
    merged.set(quarter, { revenueTarget: add(current.revenueTarget, row.revenueTarget), grossProfitTarget: add(current.grossProfitTarget, row.grossProfitTarget) });
  }
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
  );
}

export type StoredTargets = Record<Quarter, { revenue: number | null; grossProfit: number | null }>;

/** One salesperson's own targets for a year, for the form. */
export async function getOwnTargets(db: PrismaClient, viewer: Viewer, year: number): Promise<StoredTargets> {
  if (!can(viewer.role, "targets.edit")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.salesTarget.findMany({ where: { salesUserId: viewer.id, year } });
  const result = Object.fromEntries(QUARTERS.map((q) => [q, { revenue: null, grossProfit: null }])) as StoredTargets;
  for (const row of rows) result[row.quarter as Quarter] = { revenue: row.revenueTarget?.toNumber() ?? null, grossProfit: row.grossProfitTarget?.toNumber() ?? null };
  return result;
}

const quarterValues = z.object({ revenue: z.string().max(40).nullish(), grossProfit: z.string().max(40).nullish() }).strict();

const saveSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  quarters: z.object({ 1: quarterValues, 2: quarterValues, 3: quarterValues, 4: quarterValues }).strict(),
});

export type SaveTargetsResult =
  | { ok: true; changed: Quarter[] }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT"; message: string };

/**
 * Sales enter their own revenue and gross-profit targets for the four quarters of a year. A blank box means "no target":
 * a quarter with both boxes blank has no row. Only the signed-in salesperson's own targets can be written, whoever
 * is named in the request. The change and its audit event (who, which quarter, from, to) commit together.
 */
export async function saveSalesTargets(db: PrismaClient, claimedActor: Viewer, input: unknown): Promise<SaveTargetsResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "The submitted targets are invalid." };
  if (!can(claimedActor.role, "targets.edit")) return { ok: false, code: "FORBIDDEN", message: "You are not allowed to do that." };
  const { year, quarters } = parsed.data;

  const wanted = new Map<Quarter, { revenue: number | null; grossProfit: number | null }>();
  for (const quarter of QUARTERS) {
    const revenue = parseAmount(`Q${quarter} revenue target`, quarters[quarter].revenue);
    if (!revenue.ok) return { ok: false, code: "INVALID_INPUT", message: revenue.message };
    const grossProfit = parseAmount(`Q${quarter} gross profit target`, quarters[quarter].grossProfit);
    if (!grossProfit.ok) return { ok: false, code: "INVALID_INPUT", message: grossProfit.message };
    wanted.set(quarter, { revenue: revenue.value, grossProfit: grossProfit.value });
  }

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "targets.edit")) return { ok: false, code: "FORBIDDEN", message: "You are not allowed to do that." } satisfies SaveTargetsResult;

    const existing = await tx.salesTarget.findMany({ where: { salesUserId: actor.id, year } });
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const changed: Quarter[] = [];
    for (const quarter of QUARTERS) {
      const row = existing.find((r) => r.quarter === quarter);
      const was = { revenue: row?.revenueTarget?.toNumber() ?? null, grossProfit: row?.grossProfitTarget?.toNumber() ?? null };
      const now = wanted.get(quarter)!;
      if (was.revenue === now.revenue && was.grossProfit === now.grossProfit) continue;
      changed.push(quarter);
      before[`Q${quarter}`] = was;
      after[`Q${quarter}`] = now;
      if (now.revenue === null && now.grossProfit === null) {
        await tx.salesTarget.deleteMany({ where: { salesUserId: actor.id, year, quarter } });
      } else {
        await tx.salesTarget.upsert({
          where: { salesUserId_year_quarter: { salesUserId: actor.id, year, quarter } },
          create: { salesUserId: actor.id, year, quarter, revenueTarget: now.revenue, grossProfitTarget: now.grossProfit },
          update: { revenueTarget: now.revenue, grossProfitTarget: now.grossProfit },
        });
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
