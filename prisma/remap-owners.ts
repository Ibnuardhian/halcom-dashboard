// Reviewed correction of Sales accounts and project ownership (docs/decisions/DECISIONS.md D-031):
//   docker compose run --rm app npm run db:remap-owners              (dry run: reports, writes nothing)
//   docker compose run --rm app npm run db:remap-owners -- --apply   (one transaction; rolls back on any problem)
// It never deletes an account, a project or a history row. Take a backup first (Backups page or pg_dump).

import { getDb } from "@/lib/db";
import { applyOwnerRemap, planOwnerRemap, type OwnerRemapPlan } from "@/server/projects/owner-remap";

const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);

function print(plan: OwnerRemapPlan): void {
  console.log(`Rename:  [${plan.rename.status}] ${plan.rename.note}`);
  for (const move of plan.moves) console.log(`Move:    ${move.projects} project(s) ${move.fromEmail} -> ${move.toEmail}`);
  for (const other of plan.toOther) console.log(`Other:   ${other.projects} project(s) owned by ${other.ownerName} <${other.ownerEmail}> (${other.ownerRole}) become source Other`);
  console.log(`Totals:  ${plan.totals.projects} project(s): ${plan.totals.moved} moved, ${plan.totals.toOther} to Other, ${plan.totals.unchanged} unchanged (${plan.totals.deletedIncluded} soft-deleted among the changed)`);
  console.log("Owner before:");
  for (const [owner, count] of Object.entries(plan.before).sort()) console.log(`  ${String(count).padStart(3)}  ${owner}`);
  console.log("Owner after:");
  for (const [owner, count] of Object.entries(plan.after).sort()) console.log(`  ${String(count).padStart(3)}  ${owner}`);
  for (const warning of plan.warnings) console.log(`WARNING: ${warning}`);
  for (const conflict of plan.conflicts) console.log(`CONFLICT: ${conflict}`);
}

async function main(): Promise<void> {
  const appEnv = process.env["APP_ENV"];
  if (!appEnv || !ALLOWED_ENVIRONMENTS.has(appEnv)) {
    throw new Error(`Refusing to run: APP_ENV must be "development" or "test" (got "${appEnv ?? "unset"}"). Another environment needs its own reviewed procedure.`);
  }
  const apply = process.argv.includes("--apply");
  const db = getDb();
  try {
    const plan = await planOwnerRemap(db);
    console.log(apply ? "Plan (about to be applied):" : "Dry run (nothing is written; add --apply to apply):");
    print(plan);
    if (plan.conflicts.length > 0) {
      process.exitCode = 1;
      return;
    }
    if (!apply) return;

    const actor = await db.user.findFirst({ where: { role: "SUPERADMIN", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });
    if (!actor) throw new Error("No active superadmin account exists to record the change under.");
    const result = await applyOwnerRemap(db, actor.id);
    if (!result.ok) {
      console.error(`Rolled back, nothing changed: ${result.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Applied as ${actor.email}. Verified owner counts:`);
    for (const [owner, count] of Object.entries(result.verified).sort()) console.log(`  ${String(count).padStart(3)}  ${owner}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
