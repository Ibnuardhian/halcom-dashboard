// Development data cleanup (docs/decisions/DECISIONS.md D-032): obsolete synthetic accounts and the test projects of one day.
//   docker compose run --rm app npm run db:cleanup-dev                      (dry run: reports, writes nothing)
//   docker compose run --rm app npm run db:cleanup-dev -- --apply           (one transaction; rolls back on any problem)
//   options: --date=2026-10-17 (the day of the test data)  --tz=UTC (the time zone that day is read in; the application shows UTC)
// Never resets, drops or truncates. A test project is marked deleted like the application does; history stays. Take a backup first.

import { getDb } from "@/lib/db";
import { applyDevCleanup, planDevCleanup, type CleanupOptions, type CleanupPlan } from "@/server/devdata/cleanup";
import { writeDevAccountsFile } from "./dev-accounts";
import { OBSOLETE_DEV_ACCOUNTS } from "./seed-users";

const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);
const DEFAULT_DATE = "2026-10-17";
const DEFAULT_TIME_ZONE = "UTC";
const ACTOR_EMAIL = "superadmin@halcominovasi.co.id";

const argument = (name: string, fallback: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const pad = (text: string | number, width: number) => String(text).padEnd(width);

function print(plan: CleanupPlan): void {
  const { window } = plan;
  console.log(`Day: ${window.date} in ${window.timeZone} = ${window.start.toISOString()} up to (not including) ${window.end.toISOString()}`);

  console.log("\nA. Obsolete accounts");
  for (const account of plan.accounts) {
    console.log(`  [${pad(account.action.toUpperCase(), 10)}] ${pad(account.email, 30)} ${account.role ?? "-"} ${account.isActive ? "active" : "inactive"}`);
    console.log(`               ${account.reason}`);
    if (account.references.length > 0) console.log(`               references: ${account.references.map((ref) => `${ref.table}.${ref.column} x${ref.count}`).join(", ")}`);
  }

  console.log("\nB. Test projects to delete (marked deleted; history stays)");
  if (plan.testProjects.length === 0) console.log("  none");
  for (const project of plan.testProjects) {
    console.log(`  ${project.code} "${project.name}" (${project.customer}) created ${project.createdAt.toISOString()}  id ${project.id}`);
    console.log(`    evidence: ${project.evidence.join("; ")}`);
    for (const request of project.requests) console.log(`    request ${request.code} ${request.type} ${request.status} created ${request.createdAt.toISOString()}  id ${request.id}`);
    const h = project.history;
    console.log(`    stays as history: ${h.statusHistory} status rows, ${h.picAssignments} PIC assignments, ${h.projectChanges} change-log rows, ${h.projectActions} updates, ${h.auditEvents} audit events`);
    console.log(`    notifications removed: ${project.notificationIds.length}`);
  }

  console.log("\nC. Looked at on that day and NOT touched");
  if (plan.untouched.length === 0) console.log("  none");
  const byReason = new Map<string, string[]>();
  for (const record of plan.untouched) byReason.set(`${record.kind}: ${record.reason}`, [...(byReason.get(`${record.kind}: ${record.reason}`) ?? []), record.code]);
  for (const [reason, codes] of byReason) console.log(`  ${codes.length} x ${reason}${codes.length <= 6 ? `  [${codes.join(", ")}]` : `  [${codes[0]} ... ${codes[codes.length - 1]}]`}`);

  console.log("\nD. Look like test data but are outside the day (reported only)");
  if (plan.lookalikes.length === 0) console.log("  none");
  for (const record of plan.lookalikes) console.log(`  ${record.code} created ${record.createdAt.toISOString()}: ${record.reason}`);
}

async function main(): Promise<void> {
  const appEnv = process.env["APP_ENV"];
  if (!appEnv || !ALLOWED_ENVIRONMENTS.has(appEnv)) {
    throw new Error(`Refusing to run: APP_ENV must be "development" or "test" (got "${appEnv ?? "unset"}"). Another environment needs its own reviewed procedure.`);
  }
  const apply = process.argv.includes("--apply");
  const options: CleanupOptions = { date: argument("date", DEFAULT_DATE), timeZone: argument("tz", DEFAULT_TIME_ZONE), obsoleteEmails: Object.keys(OBSOLETE_DEV_ACCOUNTS) };
  const db = getDb();
  try {
    const plan = await planDevCleanup(db, options);
    console.log(apply ? "Plan (about to be applied):" : "Dry run (nothing is written; add --apply to apply):");
    print(plan);
    if (!apply) return;

    const summary = await applyDevCleanup(db, plan, options, ACTOR_EMAIL);
    console.log(`\nApplied as ${ACTOR_EMAIL} in one transaction and verified:`);
    console.log(`  projects marked deleted: ${summary.projectsDeleted} (with ${summary.requestsHidden} request(s) hidden)`);
    console.log(`  notifications removed:   ${summary.notificationsRemoved}`);
    console.log(`  accounts deleted:        ${summary.accountsDeleted.length ? summary.accountsDeleted.join(", ") : "none"}`);
    console.log(`  accounts deactivated:    ${summary.accountsDeactivated.length ? summary.accountsDeactivated.join(", ") : "none"}`);
    if (appEnv === "development") await writeDevAccountsFile(db);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
