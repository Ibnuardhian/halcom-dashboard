// Loads the RFQ ticket tracker (CSV) into the development or test database, or writes it as one SQL file for a new database (D-035):
//   docker compose run --rm app npm run db:import-rfq -- [file.csv] --dry-run        report only, writes nothing
//   docker compose run --rm app npm run db:import-rfq -- [file.csv]                  import (one transaction; only adds; safe to repeat)
//   docker compose run --rm app npm run db:rfq-sql -- [file.csv] [--out=file.sql]    write the SQL file, touches no database
//   docker compose run --rm app npm run db:import-rfq -- --rebuild [--dry-run]      bring tickets loaded earlier up to the current rules (development only)
// The CSV and the SQL hold customer names and e-mail addresses: they live in prisma/data/ (git-ignored).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/server/auth/password";
import { parseRfqTickets, planRfqImport, RFQ_IMPORT_SOURCE } from "@/server/import/rfq-tickets";
import { importRfqTickets, planFromDatabase, rebuildRfqTickets } from "@/server/import/rfq-tickets-db";
import { renderRfqSql } from "@/server/import/rfq-tickets-sql";
import { writeDevAccountsFile } from "./dev-accounts";

const DEFAULT_FILE = "prisma/data/hit_rfq_tickets_2026-10-20.csv";
const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);

const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main(): Promise<void> {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? DEFAULT_FILE;
  const { rows, problems } = parseRfqTickets(await readFile(file, "utf8"));
  if (problems.length > 0) {
    console.error(`${file} has ${problems.length} problem(s); nothing was done:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const source = `${RFQ_IMPORT_SOURCE} (${path.basename(file)})`;

  if (flag("sql")) {
    // For a new database: no existing accounts or counters are assumed.
    const { plan, problems: planProblems } = planRfqImport(rows, {}, source);
    if (!plan) {
      for (const problem of planProblems) console.error(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }
    const sql = renderRfqSql(plan, { lockedPasswordHash: await hashPassword(randomBytes(32).toString("hex")), generatedAt: new Date() });
    const out = option("out") ?? path.join("prisma", "data", "hit_rfq_tickets_import.sql");
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, sql, "utf8");
    console.log(`Wrote ${out}: ${plan.tickets.length} tickets, ${plan.projects.length} projects, ${plan.pics.length} PICs, ${plan.accounts.length} sender accounts.`);
    return;
  }

  const appEnv = process.env["APP_ENV"];
  if (!appEnv || !ALLOWED_ENVIRONMENTS.has(appEnv)) {
    throw new Error(`Refusing to import: APP_ENV must be "development" or "test" (got "${appEnv ?? "unset"}"). A production import needs its own reviewed procedure.`);
  }
  const db = getDb();
  try {
    const rebuild = flag("rebuild");
    const { plan, problems: planProblems } = await planFromDatabase(db, rows, source, { rebuild });
    if (!plan) {
      console.error("Nothing was imported:");
      for (const problem of planProblems) console.error(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }
    if (rebuild) {
      // What would change for the tickets that are already there.
      const present = await db.request.findMany({ where: { submissionKey: { in: plan.tickets.map((t) => t.key) } }, select: { submissionKey: true, code: true } });
      const was = new Map(present.map((r) => [r.submissionKey!, r.code]));
      const recoded = plan.tickets.filter((t) => was.has(t.key) && was.get(t.key) !== t.code);
      console.log(`Rebuild ${flag("dry-run") ? "(dry run, nothing written)" : ""}: ${was.size} of ${plan.tickets.length} ticket(s) are in the database, ${plan.tickets.length - was.size} would be added.`);
      for (const ticket of recoded) console.log(`  ${was.get(ticket.key)} becomes ${ticket.code}`);
      console.log(`  SOA PICs raising tickets: ${plan.tickets.filter((t) => t.raisedByPic).length} (${[...new Set(plan.tickets.flatMap((t) => (t.raisedByPic ? [t.raisedByPic] : [])))].join(", ")})`);
      if (flag("dry-run")) return;
      const result = await rebuildRfqTickets(db, plan, { fileName: source });
      console.log(`Rebuilt in one transaction: ${result.historyRowsReplaced} status history row(s) replaced, ${result.added} added, ${result.recoded.length} recoded, prefixes released: ${result.prefixesReleased.join(", ") || "none"}.`);
      if (appEnv === "development") await writeDevAccountsFile(db);
      return;
    }
    const summary = await importRfqTickets(db, plan, { dryRun: flag("dry-run"), fileName: source });
    console.log(`${summary.dryRun ? "Dry run (nothing written)" : "Imported"}: ${path.basename(file)}, ${rows.length} ticket(s) in the file.`);
    console.log(`  requests: ${summary.requestsToCreate.length} new, ${summary.requestsExisting.length} already present (left untouched)`);
    for (const request of summary.requestsToCreate) console.log(`    ${request.code}  ${request.status}`);
    console.log(`  projects: ${summary.projectsToCreate} new, ${summary.projectsExisting} already present`);
    console.log(`  PICs:     ${summary.picsToCreate.length ? summary.picsToCreate.join(", ") : "none new"}`);
    console.log(`  accounts: ${summary.accountsToCreate.length ? `${summary.accountsToCreate.join(", ")} (inactive, history only)` : "none new"}`);
    console.log(`  code prefixes set: ${summary.prefixesToSet.map((p) => `${p.email} = ${p.prefix}`).join(", ") || "none"}`);
    if (!summary.dryRun && appEnv === "development") await writeDevAccountsFile(db);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
