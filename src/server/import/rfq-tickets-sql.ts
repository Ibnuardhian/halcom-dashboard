import { nameKey } from "@/domain/projects/pipeline";
import type { PlannedTicket, RfqPlan } from "./rfq-tickets";

/** A SQL string literal: quotes doubled, NUL refused. The values come from a CSV, so nothing is trusted. */
export function sqlText(value: string | null): string {
  if (value === null) return "NULL";
  if (value.includes("\u0000")) throw new Error("A value contains a NUL character.");
  return `'${value.replaceAll("'", "''")}'`;
}
const sqlTime = (value: Date | null) => (value === null ? "NULL" : `'${value.toISOString()}'::timestamptz`);
const list = (rows: string[]) => rows.map((row) => `  ${row}`).join(",\n");

export type SqlOptions = {
  /** Hash for the accounts that only exist to name a sender in history (inactive; nobody knows the password). */
  lockedPasswordHash: string;
  generatedAt: Date;
  /** The audit actor. */
  actorEmail?: string;
  /** Wrap the script in BEGIN/COMMIT (default). A test turns it off to roll back itself. */
  transaction?: boolean;
};

const ticketRow = (t: PlannedTicket, seq: number) =>
  `(${seq}, ${sqlText(t.code)}, ${sqlText(t.key)}, ${sqlText(t.projectKey)}, ${sqlText(t.requesterEmail)}, ${sqlText(t.title)}, ${sqlText(t.description)}, ${sqlText(t.status)}, ` +
  `${sqlTime(t.createdAt)}, ${sqlTime(t.completedAt)}, ${sqlTime(t.steps.at(-1)?.at ?? t.createdAt)}, ${sqlText(t.picName ? nameKey(t.picName) : null)}, ${sqlText(t.raisedByPic ? nameKey(t.raisedByPic) : null)})`;

const stepRows = (tickets: readonly PlannedTicket[]) =>
  tickets.flatMap((t) => t.steps.map((step, n) => `(${sqlText(t.key)}, ${n + 1}, ${sqlText(step.from)}, ${sqlText(step.to)}, ${sqlTime(step.at)}, ${sqlText(step.reason)})`));

/**
 * One SQL file that loads the plan into a database that already has the schema (`prisma migrate deploy`) and the development accounts
 * (`npm run db:seed`). It follows the same rules as the importer: it only adds, a ticket whose key exists is skipped, so it can be run
 * twice; any error rolls the whole file back. Request and project numbers are taken from the counters, so it can also be loaded into a
 * database that already holds projects.
 */
export function renderRfqSql(plan: RfqPlan, options: SqlOptions): string {
  const fileName = plan.source;
  const actor = sqlText(options.actorEmail ?? "superadmin@example.invalid");
  const purchasing = `(SELECT id FROM users WHERE email = 'purchasing@example.invalid')`;
  const out: string[] = [];
  const add = (...lines: string[]) => out.push(...lines, "");

  add(
    `-- ${plan.source}: ${plan.tickets.length} RFQ tickets, ${plan.projects.length} projects, ${plan.pics.length} PICs, ${plan.accounts.length} sender accounts.`,
    `-- Generated ${options.generatedAt.toISOString()} by "npm run db:rfq-sql". Contains customer names: do not commit or share.`,
    `--`,
    `-- Load into a new database:`,
    `--   1. docker compose run --rm app npm run db:migrate:deploy      (the schema)`,
    `--   2. docker compose run --rm app npm run db:seed                (the development accounts: this file needs purchasing@, soa@, superadmin@, satrio@ and dzaki@)`,
    `--   3. psql -v ON_ERROR_STOP=1 -f <this file>`,
    `-- It only adds. Running it again skips every ticket that is already there. Any error rolls back the whole file.`,
    `-- The code prefix of an account is set only if the account has none; if another account already holds that prefix the load stops.`,
  );
  if (options.transaction !== false) add("BEGIN;");

  add(
    `-- Staging: the tracker rows after planning (codes, prefixes, PICs and times are already decided).`,
    `CREATE TEMP TABLE rfq_stage (seq int, code text, ticket_key text, project_key text, requester_email text, title text, description text, status text,`,
    `  created_at timestamptz, completed_at timestamptz, updated_at timestamptz, pic_key text, raised_pic_key text) ON COMMIT DROP;`,
    `INSERT INTO rfq_stage VALUES`,
    list(plan.tickets.map((ticket, index) => ticketRow(ticket, index + 1))) + ";",
    ...(plan.tickets.some((t) => t.steps.length > 0)
      ? [
          `CREATE TEMP TABLE rfq_stage_steps (ticket_key text, n int, from_status text, to_status text, at timestamptz, reason text) ON COMMIT DROP;`,
          `INSERT INTO rfq_stage_steps VALUES`,
          list(stepRows(plan.tickets)) + ";",
        ]
      : [`CREATE TEMP TABLE rfq_stage_steps (ticket_key text, n int, from_status text, to_status text, at timestamptz, reason text) ON COMMIT DROP;`]),
    `CREATE TEMP TABLE rfq_stage_projects (seq int, project_key text, customer text, customer_key text, name text, owner_email text, external_name text, technical_email text, created_at timestamptz) ON COMMIT DROP;`,
    `INSERT INTO rfq_stage_projects VALUES`,
    list(plan.projects.map((p, index) => `(${index + 1}, ${sqlText(p.key)}, ${sqlText(p.customer)}, ${sqlText(p.customerKey)}, ${sqlText(p.name)}, ${sqlText(p.ownerEmail)}, ${sqlText(p.externalSourceName)}, ${sqlText(p.technicalPicEmail)}, ${sqlTime(p.createdAt)})`)) + ";",
  );

  const historyAccounts = plan.accounts.filter((a) => a.historyOnly);
  if (historyAccounts.length > 0) {
    add(
      `-- Accounts that only name a sender in history: inactive, with a password nobody knows. The working accounts come from "npm run db:seed".`,
      `INSERT INTO users (id, name, email, password_hash, role, is_active, updated_at) VALUES`,
      list(historyAccounts.map((a) => `(uuidv7(), ${sqlText(a.name)}, ${sqlText(a.email)}, ${sqlText(options.lockedPasswordHash)}, ${sqlText(a.role)}::"Role", false, now())`)),
      `ON CONFLICT (email) DO NOTHING;`,
    );
  }

  if (plan.prefixes.length > 0) {
    add(
      `-- Request code prefixes (one letter; more only where the letter is taken). Kept if the account already has one.`,
      `UPDATE users SET code_prefix = v.prefix, updated_at = now() FROM (VALUES`,
      list(plan.prefixes.map((p) => `(${sqlText(p.email)}, ${sqlText(p.prefix)})`)),
      `) AS v(email, prefix) WHERE users.email = v.email AND users.code_prefix IS NULL;`,
    );
  }

  add(
    `-- Customers (a name that exists is kept).`,
    `INSERT INTO customers (id, name, name_key, updated_at)`,
    `SELECT uuidv7(), customer, customer_key, now() FROM (SELECT DISTINCT ON (customer_key) customer, customer_key FROM rfq_stage_projects ORDER BY customer_key, seq) c`,
    `ON CONFLICT (name_key) DO NOTHING;`,
  );

  if (plan.pics.length > 0) {
    add(
      `-- PICs: Purchasing's (who work the RFQs) and SOA's (who raised some of them).`,
      `INSERT INTO pics (id, team, name, name_key, updated_at) VALUES`,
      list(plan.pics.map((p) => `(uuidv7(), ${sqlText(p.team)}::"PicTeam", ${sqlText(p.name)}, ${sqlText(p.key)}, now())`)),
      `ON CONFLICT (team, name_key) DO NOTHING;`,
    );
  }

  add(
    `-- Projects, numbered after the highest project number in this database.`,
    `WITH base AS (SELECT GREATEST(COALESCE((SELECT last_value FROM code_counters WHERE scope = 'PRJ-'), 0), COALESCE((SELECT max(substr(code, 5)::int) FROM projects), 0)) AS n),`,
    `todo AS (SELECT sp.*, row_number() OVER (ORDER BY sp.seq) AS rn FROM rfq_stage_projects sp`,
    `        WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.submission_key = sp.project_key))`,
    `INSERT INTO projects (id, code, end_user_company, name, customer_id, source_type, sales_owner_id, external_source_name, technical_pic_id, submission_key, imported_from, created_at, updated_at)`,
    `SELECT uuidv7(), 'PRJ-' || CASE WHEN base.n + todo.rn >= 1000 THEN (base.n + todo.rn)::text ELSE lpad((base.n + todo.rn)::text, 3, '0') END,`,
    `       todo.customer, todo.name, c.id,`,
    `       CASE WHEN todo.owner_email IS NULL THEN 'OTHER' ELSE 'INTERNAL_SALES' END::"ProjectSourceType",`,
    `       u.id, todo.external_name, tu.id, todo.project_key, ${sqlText(fileName)}, todo.created_at, todo.created_at`,
    `FROM todo CROSS JOIN base`,
    `JOIN customers c ON c.name_key = todo.customer_key`,
    `LEFT JOIN users u ON u.email = todo.owner_email`,
    `LEFT JOIN users tu ON tu.email = todo.technical_email`,
    `ORDER BY todo.seq;`,
    `INSERT INTO code_counters (scope, last_value) SELECT 'PRJ-', max(substr(code, 5)::int) FROM projects`,
    `ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(code_counters.last_value, EXCLUDED.last_value);`,
    `INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after)`,
    `SELECT uuidv7(), (SELECT id FROM users WHERE email = ${actor}), 'project.imported', 'project', p.id::text, jsonb_build_object('code', p.code, 'source', ${sqlText(fileName)})`,
    `FROM projects p WHERE p.submission_key IN (SELECT project_key FROM rfq_stage_projects)`,
    `  AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.entity_type = 'project' AND a.entity_id = p.id::text AND a.action = 'project.imported');`,
  );

  add(
    `-- Requests. A ticket whose key is already there is skipped.`,
    `INSERT INTO requests (id, code, type, project_id, status, title, description, requester_id, pic_id, raised_by_pic_id, submission_key, completed_at, imported_from, created_at, updated_at)`,
    `SELECT uuidv7(), s.code, 'RFQ'::"RequestType", p.id, s.status::"RequestStatus", s.title, s.description, ru.id, pic.id, soa.id, s.ticket_key, s.completed_at,`,
    `       ${sqlText(fileName)}, s.created_at, s.updated_at`,
    `FROM rfq_stage s`,
    `JOIN projects p ON p.submission_key = s.project_key`,
    `JOIN users ru ON ru.email = s.requester_email`,
    `LEFT JOIN pics pic ON pic.team = 'PURCHASING' AND pic.name_key = s.pic_key`,
    `LEFT JOIN pics soa ON soa.team = 'SOA' AND soa.name_key = s.raised_pic_key`,
    `WHERE NOT EXISTS (SELECT 1 FROM requests r WHERE r.submission_key = s.ticket_key)`,
    `ORDER BY s.seq;`,
  );

  add(
    `-- Status history (append-only table): raised, then the Purchasing team's moves. The response date is the move to In progress; the tracker note is the reason of the last move.`,
    `INSERT INTO request_status_history (id, request_id, from_status, to_status, changed_by_id, changed_at, reason)`,
    `SELECT uuidv7(), r.id, NULL, 'SUBMITTED'::"RequestStatus", r.requester_id, s.created_at, NULL`,
    `FROM rfq_stage s JOIN requests r ON r.submission_key = s.ticket_key`,
    `WHERE NOT EXISTS (SELECT 1 FROM request_status_history h WHERE h.request_id = r.id);`,
    `INSERT INTO request_status_history (id, request_id, from_status, to_status, changed_by_id, changed_at, reason)`,
    `SELECT uuidv7(), r.id, st.from_status::"RequestStatus", st.to_status::"RequestStatus", ${purchasing}, st.at, st.reason`,
    `FROM rfq_stage_steps st JOIN requests r ON r.submission_key = st.ticket_key`,
    `WHERE NOT EXISTS (SELECT 1 FROM request_status_history h WHERE h.request_id = r.id AND h.to_status = st.to_status::"RequestStatus")`,
    `ORDER BY st.ticket_key, st.n;`,
    `INSERT INTO request_pic_assignments (id, request_id, from_pic_id, to_pic_id, changed_by_id, changed_at)`,
    `SELECT uuidv7(), r.id, NULL, r.pic_id, ${purchasing}, COALESCE((SELECT min(st.at) FROM rfq_stage_steps st WHERE st.ticket_key = s.ticket_key), s.created_at)`,
    `FROM rfq_stage s JOIN requests r ON r.submission_key = s.ticket_key`,
    `WHERE r.pic_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM request_pic_assignments a WHERE a.request_id = r.id);`,
    `INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, after)`,
    `SELECT uuidv7(), (SELECT id FROM users WHERE email = ${actor}), 'request.imported', 'request', r.id::text, jsonb_build_object('code', r.code, 'status', r.status, 'source', ${sqlText(fileName)})`,
    `FROM rfq_stage s JOIN requests r ON r.submission_key = s.ticket_key`,
    `WHERE NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.entity_type = 'request' AND a.entity_id = r.id::text AND a.action = 'request.imported');`,
  );

  add(
    `-- Counters: the next new request continues after the highest number used here.`,
    `INSERT INTO code_counters (scope, last_value) VALUES`,
    list(plan.counters.map((c) => `(${sqlText(c.scope)}, ${c.last})`)),
    `ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(code_counters.last_value, EXCLUDED.last_value);`,
  );

  if (options.transaction !== false) add("COMMIT;");
  return out.join("\n");
}
