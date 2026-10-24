import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { SOURCE_LABELS } from "@/domain/projects/source";

/**
 * One-off, reviewed correction of Sales accounts and project ownership (D-031). It only ever moves a project to another
 * account or to the source Other; no account is deleted, and a project's requests, status history, change log and audit
 * trail stay where they are. `planOwnerRemap` reads and reports (the dry run); `applyOwnerRemap` repeats the plan inside one
 * transaction, changes the data, checks the result and rolls everything back if anything is off.
 */
export type OwnerRemapRules = {
  /** The account that is renamed (its id, role, history and sessions stay). */
  rename: { fromEmail: string; toEmail: string; toName: string };
  /** Every project owned by `fromEmail` goes to `toEmail`, in this order. */
  moves: readonly { fromEmail: string; toEmail: string }[];
  /** Every project whose owner is not one of these accounts becomes source Other. */
  keepEmails: readonly string[];
  /** Tests only: leave alone every project whose owner is not in this list (the test database is shared). */
  onlyOwnerEmails?: readonly string[];
};

export const DEFAULT_OWNER_REMAP: OwnerRemapRules = {
  rename: { fromEmail: "mas.dzaki@halcominovasi.co.id", toEmail: "dzaki@halcominovasi.co.id", toName: "Dzaki" },
  moves: [
    { fromEmail: "soraya@halcominovasi.co.id", toEmail: "dzaki@halcominovasi.co.id" },
    { fromEmail: "gusti@halcominovasi.co.id", toEmail: "satrio@halcominovasi.co.id" },
  ],
  keepEmails: ["dzaki@halcominovasi.co.id", "satrio@halcominovasi.co.id"],
};

export type RemapProjectAction = "stay" | "move" | "to-other" | "untouched";

export type OwnerRemapPlan = {
  rename: { status: "pending" | "already-done" | "blocked"; note: string };
  moves: { fromEmail: string; toEmail: string; projects: number }[];
  toOther: { ownerEmail: string; ownerName: string; ownerRole: string; projects: number }[];
  /** Anything here stops the apply. */
  conflicts: string[];
  /** Not blocking, but a person should read it before applying. */
  warnings: string[];
  /** Projects per owner label (or source Other) before and after. */
  before: Record<string, number>;
  after: Record<string, number>;
  totals: { projects: number; moved: number; toOther: number; unchanged: number; deletedIncluded: number };
  /** What happens to each project, for the apply step. */
  actions: { projectId: string; code: string; action: RemapProjectAction; toEmail?: string; ownerEmail?: string }[];
};

type Db = PrismaClient | Prisma.TransactionClient;

const OTHER_LABEL = "Other (no internal Sales PIC)";
const labelOf = (person: { name: string; email: string }) => `${person.name} (${person.email})`;

/** Reads the data and works out what the rules would do. Writes nothing. */
export async function planOwnerRemap(db: Db, rules: OwnerRemapRules = DEFAULT_OWNER_REMAP): Promise<OwnerRemapPlan> {
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const emails = new Set<string>([rules.rename.fromEmail, rules.rename.toEmail, ...rules.moves.flatMap((m) => [m.fromEmail, m.toEmail]), ...rules.keepEmails]);
  const users = await db.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true, name: true, email: true, role: true, isActive: true } });
  const byEmail = new Map(users.map((user) => [user.email, user]));

  // 1. The rename. After it, the account found under the old address answers to the new one.
  const renameFrom = byEmail.get(rules.rename.fromEmail);
  const renameTo = byEmail.get(rules.rename.toEmail);
  const rename: OwnerRemapPlan["rename"] = { status: "pending", note: "" };
  if (renameFrom && renameTo) {
    rename.status = "blocked";
    rename.note = `Both ${rules.rename.fromEmail} and ${rules.rename.toEmail} exist as separate accounts; they are not merged without evidence that they are one person.`;
    conflicts.push(rename.note);
  } else if (renameFrom) {
    rename.note = `${labelOf(renameFrom)} becomes ${rules.rename.toName} (${rules.rename.toEmail}); the account id, role, history and sessions are kept.`;
    if (renameFrom.role !== "SALES") warnings.push(`${rules.rename.fromEmail} is not a Sales account (role ${renameFrom.role}).`);
  } else if (renameTo) {
    rename.status = "already-done";
    rename.note = `${rules.rename.toEmail} already exists and ${rules.rename.fromEmail} does not: the rename was done before.`;
  } else {
    rename.status = "blocked";
    rename.note = `Neither ${rules.rename.fromEmail} nor ${rules.rename.toEmail} exists.`;
    conflicts.push(rename.note);
  }
  // The account that carries the new address once the rename is done.
  const renamed = renameFrom ?? renameTo;
  const accountFor = (email: string) => (email === rules.rename.toEmail ? renamed : byEmail.get(email));

  // 2. The moves: both ends must exist as active Sales accounts.
  for (const move of rules.moves) {
    const target = accountFor(move.toEmail);
    if (!target) conflicts.push(`The target account ${move.toEmail} does not exist.`);
    else if (!target.isActive || target.role !== "SALES") conflicts.push(`The target account ${move.toEmail} must be an active Sales account.`);
    const source = byEmail.get(move.fromEmail);
    if (!source) warnings.push(`The source account ${move.fromEmail} does not exist; there is nothing to move from it.`);
    else if (source.role !== "SALES") warnings.push(`${move.fromEmail} is not a Sales account (role ${source.role}); its projects are moved anyway because the rule names it.`);
  }
  for (const email of rules.keepEmails) {
    const keeper = accountFor(email);
    if (!keeper) conflicts.push(`The Sales account ${email} that keeps its projects does not exist.`);
  }

  // 3. What happens to each project.
  const projects = await db.project.findMany({
    select: { id: true, code: true, sourceType: true, deletedAt: true, salesOwner: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
    orderBy: { code: "asc" },
  });
  const moveBySource = new Map(rules.moves.map((move) => [move.fromEmail, move.toEmail]));
  const keepers = new Set(rules.keepEmails);
  // A project owned by the account under its old address is, after the rename, owned by the new address.
  const effectiveEmail = (email: string) => (email === rules.rename.fromEmail ? rules.rename.toEmail : email);
  const scope = rules.onlyOwnerEmails ? new Set(rules.onlyOwnerEmails) : null;

  const actions: OwnerRemapPlan["actions"] = [];
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  const movedCounts = new Map<string, number>();
  const otherCounts = new Map<string, { name: string; role: string; count: number }>();
  let deletedIncluded = 0;
  const bump = (counts: Record<string, number>, key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  for (const project of projects) {
    const owner = project.salesOwner;
    if (project.sourceType === "OTHER" || !owner) {
      bump(before, OTHER_LABEL);
      bump(after, OTHER_LABEL);
      actions.push({ projectId: project.id, code: project.code, action: "untouched" });
      continue;
    }
    bump(before, labelOf(owner));
    if (scope && !scope.has(owner.email)) {
      bump(after, labelOf(owner));
      actions.push({ projectId: project.id, code: project.code, action: "untouched" });
      continue;
    }
    if (project.deletedAt) deletedIncluded += 1;
    const moveTo = moveBySource.get(owner.email);
    if (moveTo) {
      const target = accountFor(moveTo);
      bump(after, target ? labelOf({ name: moveTo === rules.rename.toEmail ? rules.rename.toName : target.name, email: moveTo }) : moveTo);
      movedCounts.set(`${owner.email}>${moveTo}`, (movedCounts.get(`${owner.email}>${moveTo}`) ?? 0) + 1);
      actions.push({ projectId: project.id, code: project.code, action: "move", toEmail: moveTo, ownerEmail: owner.email });
    } else if (keepers.has(effectiveEmail(owner.email))) {
      bump(after, owner.email === rules.rename.fromEmail ? labelOf({ name: rules.rename.toName, email: rules.rename.toEmail }) : labelOf(owner));
      actions.push({ projectId: project.id, code: project.code, action: "stay", ownerEmail: owner.email });
    } else {
      bump(after, OTHER_LABEL);
      const entry = otherCounts.get(owner.email) ?? { name: owner.name, role: owner.role, count: 0 };
      entry.count += 1;
      otherCounts.set(owner.email, entry);
      actions.push({ projectId: project.id, code: project.code, action: "to-other", ownerEmail: owner.email });
      if (owner.role !== "SALES") warnings.push(`${project.code} is owned by ${labelOf(owner)}, who is not a Sales account (role ${owner.role}); it becomes Other with that name recorded as the external source.`);
      else if (!owner.isActive) warnings.push(`${project.code} is owned by ${labelOf(owner)}, an inactive account; it becomes Other.`);
    }
  }

  const moves = rules.moves.map((move) => ({ ...move, projects: movedCounts.get(`${move.fromEmail}>${move.toEmail}`) ?? 0 }));
  const toOther = [...otherCounts.entries()].map(([ownerEmail, value]) => ({ ownerEmail, ownerName: value.name, ownerRole: value.role, projects: value.count }));
  const moved = moves.reduce((sum, move) => sum + move.projects, 0);
  const otherTotal = toOther.reduce((sum, entry) => sum + entry.projects, 0);
  return {
    rename,
    moves,
    toOther,
    conflicts,
    warnings,
    before,
    after,
    totals: { projects: projects.length, moved, toOther: otherTotal, unchanged: actions.filter((a) => a.action === "stay" || a.action === "untouched").length, deletedIncluded },
    actions,
  };
}

export type OwnerRemapResult =
  | { ok: true; plan: OwnerRemapPlan; verified: OwnerRemapPlan["after"] }
  | { ok: false; code: "FORBIDDEN" | "CONFLICT" | "VERIFY_FAILED"; message: string; plan?: OwnerRemapPlan };

export type ApplyOptions = {
  /** Tests only: called after each step, inside the transaction. Throwing from it must roll everything back. */
  onStep?: (step: "rename" | "moves" | "other") => void | Promise<void>;
};

/** Applies the rules in one transaction. Superadmin only. A conflict, a failed check or an error leaves the data exactly as it was. */
export async function applyOwnerRemap(db: PrismaClient, actorId: string, rules: OwnerRemapRules = DEFAULT_OWNER_REMAP, options: ApplyOptions = {}): Promise<OwnerRemapResult> {
  class Abort extends Error {
    constructor(readonly result: OwnerRemapResult) {
      super("owner remap aborted");
    }
  }
  try {
    return await db.$transaction(
      async (tx): Promise<OwnerRemapResult> => {
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, isActive: true } });
        if (!actor?.isActive || actor.role !== "SUPERADMIN") throw new Abort({ ok: false, code: "FORBIDDEN", message: "Only an active superadmin can apply this migration." });

        // Stop other writers on the projects table while the plan is made and applied.
        await tx.$executeRaw`LOCK TABLE projects IN SHARE ROW EXCLUSIVE MODE`;
        const plan = await planOwnerRemap(tx, rules);
        if (plan.conflicts.length > 0) throw new Abort({ ok: false, code: "CONFLICT", message: plan.conflicts.join(" "), plan });

        // 1. Rename. The row keeps its id, so every reference follows.
        const renameFrom = await tx.user.findUnique({ where: { email: rules.rename.fromEmail } });
        let renamed = renameFrom ?? (await tx.user.findUniqueOrThrow({ where: { email: rules.rename.toEmail } }));
        if (renameFrom) {
          renamed = await tx.user.update({ where: { id: renameFrom.id }, data: { name: rules.rename.toName, email: rules.rename.toEmail } });
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: "user.renamed",
              entityType: "user",
              entityId: renameFrom.id,
              before: { name: renameFrom.name, email: renameFrom.email },
              after: { name: renamed.name, email: renamed.email },
            },
          });
        }
        await options.onStep?.("rename");

        const need = async (email: string) => (email === rules.rename.toEmail ? renamed : tx.user.findUniqueOrThrow({ where: { email } }));
        const people = new Map<string, { id: string; name: string; email: string }>();
        const projectRows = await tx.project.findMany({
          where: { id: { in: plan.actions.filter((a) => a.action === "move" || a.action === "to-other").map((a) => a.projectId) } },
          select: { id: true, code: true, salesOwnerId: true, sourceType: true },
        });
        const rowById = new Map(projectRows.map((row) => [row.id, row]));
        for (const row of projectRows) {
          if (row.salesOwnerId && !people.has(row.salesOwnerId)) {
            people.set(row.salesOwnerId, await tx.user.findUniqueOrThrow({ where: { id: row.salesOwnerId }, select: { id: true, name: true, email: true } }));
          }
        }

        // 2. Moves: the owner changes, nothing else about the project.
        const now = new Date();
        for (const action of plan.actions.filter((a) => a.action === "move")) {
          const row = rowById.get(action.projectId)!;
          const from = people.get(row.salesOwnerId!)!;
          const target = await need(action.toEmail!);
          await tx.project.update({ where: { id: row.id }, data: { salesOwnerId: target.id } });
          await tx.projectChange.create({ data: { projectId: row.id, changedById: actor.id, field: "salesOwner", fromValue: labelOf(from), toValue: labelOf(target), changedAt: now } });
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: "project.owner_remapped",
              entityType: "project",
              entityId: row.id,
              before: { salesOwner: labelOf(from) },
              after: { salesOwner: labelOf(target) },
            },
          });
        }
        await options.onStep?.("moves");

        // 3. Everything else becomes Other. The earlier owner is kept as the external source name, so no evidence is lost.
        for (const action of plan.actions.filter((a) => a.action === "to-other")) {
          const row = rowById.get(action.projectId)!;
          const from = people.get(row.salesOwnerId!)!;
          await tx.project.update({
            where: { id: row.id },
            data: {
              sourceType: "OTHER",
              salesOwnerId: null,
              externalSourceName: from.name,
              sourceNotes: `Previously owned by ${labelOf(from)}; moved to Other because that account is not one of the Sales accounts that keep internal projects.`,
            },
          });
          await tx.projectChange.createMany({
            data: [
              { projectId: row.id, changedById: actor.id, field: "salesOwner", fromValue: labelOf(from), toValue: null, changedAt: now },
              { projectId: row.id, changedById: actor.id, field: "sourceType", fromValue: SOURCE_LABELS.INTERNAL_SALES, toValue: SOURCE_LABELS.OTHER, changedAt: now },
              { projectId: row.id, changedById: actor.id, field: "externalSourceName", fromValue: null, toValue: from.name, changedAt: now },
            ],
          });
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: "project.owner_remapped",
              entityType: "project",
              entityId: row.id,
              before: { salesOwner: labelOf(from), sourceType: "INTERNAL_SALES" },
              after: { salesOwner: null, sourceType: "OTHER", externalSourceName: from.name },
            },
          });
        }
        await options.onStep?.("other");

        // 4. Check the result against the plan; a difference rolls everything back.
        const verified = await planOwnerRemap(tx, rules);
        const expected = JSON.stringify(Object.entries(plan.after).sort());
        const actual = JSON.stringify(Object.entries(verified.before).sort());
        if (expected !== actual) {
          throw new Abort({ ok: false, code: "VERIFY_FAILED", message: "The ownership counts after the change differ from the plan; everything was rolled back.", plan });
        }
        return { ok: true, plan, verified: verified.before };
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}
