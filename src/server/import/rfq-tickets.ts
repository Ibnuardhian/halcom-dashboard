import { createHash } from "node:crypto";
import { cleanName, nameKey } from "@/domain/projects/pipeline";
import { CODE_PREFIX_PATTERN, codeScope, formatCode, pickCodePrefix, twoDigitYear } from "@/domain/requests/codes";
import type { Role } from "@/domain/access/roles";
import type { PicTeam } from "@/domain/pics/teams";
import { parseCsv, recordsWithHeader } from "./csv";

/**
 * The RFQ ticket tracker (the "HIT RFQ" sheet) as data for the application (D-035, D-036). Reading and planning are pure: the plan says exactly
 * which accounts, PICs, projects, requests and history rows the import writes, and two sinks apply it: `importRfqTickets` (the database
 * through Prisma, idempotent) and `renderRfqSql` (one SQL file for a new database). Both read the same plan, so they cannot disagree.
 */

export const RFQ_IMPORT_SOURCE = "HIT RFQ tracker";

const REQUIRED_COLUMNS = ["TicketID", "Tanggal Masuk", "Tanggal Response", "Pengirim", "Customer", "Project", "Status", "PIC", "Catatan"] as const;

/** The sheet's statuses and the request status each becomes. */
export const TICKET_STATUSES = { Done: "COMPLETED", Failed: "CANCELLED", "On Going": "IN_PROGRESS", Baru: "SUBMITTED" } as const;
export type TicketStatusLabel = keyof typeof TICKET_STATUSES;
export type TicketRequestStatus = (typeof TICKET_STATUSES)[TicketStatusLabel];

export type TicketRow = {
  line: number;
  ticketId: string | null;
  entryDate: string;
  responseDate: string | null;
  senderEmail: string;
  customer: string;
  project: string;
  statusLabel: TicketStatusLabel;
  pics: string[];
  note: string | null;
  /** The mail's Message-ID. Not stored: it only keeps the ticket's key stable, so running the import twice finds the same ticket. */
  messageId: string | null;
};

const cell = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match !== null && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().slice(0, 10) === value;
}

/** "Gita & Soraya" is two people. */
export function splitPics(raw: string | null): string[] {
  return (raw ?? "")
    .split(/\s*(?:&|,|\/|\bdan\b)\s*/i)
    .map(cleanName)
    .filter((name) => name !== "");
}

export function parseRfqTickets(csv: string): { rows: TicketRow[]; problems: string[] } {
  const problems: string[] = [];
  const all = parseCsv(csv);
  const header = all[0] ?? [];
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) return { rows: [], problems: [`The file has no column ${missing.map((m) => `"${m}"`).join(", ")}.`] };
  // Short rows (the sheet leaves trailing empty cells out) are padded rather than rejected.
  const padded = all.map((row, index) => (index === 0 || row.length >= header.length ? row : [...row, ...Array(header.length - row.length).fill("")]));
  const { records, problems: shape } = recordsWithHeader(padded);
  problems.push(...shape);

  const rows: TicketRow[] = [];
  records.forEach((record, index) => {
    const line = index + 2;
    const where = `Line ${line}`;
    const entryDate = cell(record["Tanggal Masuk"]);
    const responseDate = cell(record["Tanggal Response"]);
    const statusLabel = cell(record["Status"]);
    const sender = cell(record["Pengirim"])?.toLowerCase() ?? null;
    const customer = cell(record["Customer"]);
    const project = cell(record["Project"]);
    if (!entryDate || !validDate(entryDate)) problems.push(`${where}: "Tanggal Masuk" ${entryDate ? `"${entryDate}" is not` : "is not"} a valid YYYY-MM-DD date.`);
    if (responseDate && !validDate(responseDate)) problems.push(`${where}: "Tanggal Response" "${responseDate}" is not a valid YYYY-MM-DD date.`);
    if (entryDate && responseDate && validDate(entryDate) && validDate(responseDate) && responseDate < entryDate) problems.push(`${where}: the response is dated before the ticket came in.`);
    if (!statusLabel || !(statusLabel in TICKET_STATUSES)) problems.push(`${where}: status "${statusLabel ?? ""}" is not one of ${Object.keys(TICKET_STATUSES).join(", ")}.`);
    if (!sender || !sender.includes("@")) problems.push(`${where}: "Pengirim" is not an e-mail address.`);
    if (!customer) problems.push(`${where}: "Customer" is empty.`);
    if (!project) problems.push(`${where}: "Project" is empty.`);
    if (project && project.length > 120) problems.push(`${where}: the project name is longer than 120 characters.`);
    const ticketId = cell(record["TicketID"]);
    if (ticketId && !/^RFQ-[A-Z0-9]{1,3}-\d{2}\d{4,}$/.test(ticketId)) problems.push(`${where}: ticket id "${ticketId}" is not an RFQ code.`);
    if (!entryDate || !validDate(entryDate) || !statusLabel || !(statusLabel in TICKET_STATUSES) || !sender || !customer || !project) return;
    rows.push({
      line,
      ticketId,
      entryDate,
      responseDate: responseDate && validDate(responseDate) ? responseDate : null,
      senderEmail: sender,
      customer: cleanName(customer),
      project: cleanName(project),
      statusLabel: statusLabel as TicketStatusLabel,
      pics: splitPics(cell(record["PIC"])),
      note: cell(record["Catatan"]),
      messageId: cell(record["MessageID"]),
    });
  });
  return { rows, problems };
}

/** How a sender of the sheet maps to accounts and to the project owner (keyed by the part of the address before "@"). */
export type SenderMapping = {
  /**
   * The account that raised the request. A `historyOnly` account is created locked and inactive when it does not exist (the person only
   * appears in history). Any other must already exist (`npm run db:seed`): the import does not invent a working account.
   */
  account: { email: string; name: string; role: Role; historyOnly?: true };
  /**
   * Set when the sender is a SOA person: SOA signs in with one shared account, so the request is raised by that account and the person is
   * this SOA PIC. The same person is the project's Technical PIC (SOA), never its Sales name; that needs an account, which exists only for history.
   */
  soaPic?: { name: string; technicalAccount: { email: string; name: string; role: Role; historyOnly: true } };
  /** Who owns the projects they raise: an internal salesperson, or nobody (a SOA project: source Other, no Sales PIC). */
  owner: { kind: "sales"; email: string } | { kind: "soa" };
};

/** A project SOA raises for itself has no Sales PIC. The database wants a name for source Other, and this says what it is. */
export const SOA_PROJECT_SOURCE_NAME = "Internal SOA request";

const SOA_LOGIN = { email: "soa@example.invalid", name: "Dev Soa", role: "SOA" } as const;

/**
 * Senders of the sheet. A sender not listed stops the import: nobody is guessed. Gusti's projects belong to Satrio (D-031). Adityo and
 * Ibnu are SOA PICs (D-036): their tickets are raised through the shared SOA login and carry the PIC, and the project has no Sales PIC (source Other)
 * but a Technical PIC (SOA).
 */
export const SENDER_MAPPINGS: Readonly<Record<string, SenderMapping>> = {
  "satrio.akbar": { account: { email: "satrio@example.invalid", name: "Satrio", role: "SALES" }, owner: { kind: "sales", email: "satrio@example.invalid" } },
  "gusti.nirmala": { account: { email: "gusti@example.invalid", name: "Gusti", role: "SALES", historyOnly: true }, owner: { kind: "sales", email: "satrio@example.invalid" } },
  dzaki: { account: { email: "dzaki@example.invalid", name: "Dzaki", role: "SALES" }, owner: { kind: "sales", email: "dzaki@example.invalid" } },
  "adityo.prabowo": { account: SOA_LOGIN, soaPic: { name: "Adityo", technicalAccount: { email: "adityo@example.invalid", name: "Adityo", role: "SOA", historyOnly: true } }, owner: { kind: "soa" } },
  "ibnu.ardhiansyah": { account: SOA_LOGIN, soaPic: { name: "Ibnu", technicalAccount: { email: "ibnu.ardhiansyah@example.invalid", name: "Ibnu Ardhiansyah", role: "SOA", historyOnly: true } }, owner: { kind: "soa" } },
};

/** Working hours the sheet's bare dates are given (Asia/Jakarta): the ticket comes in at 09:00, is taken up at 15:00, and an outcome is set at 17:00. */
const HOURS_UTC = { entry: "02:00:00.000Z", response: "08:00:00.000Z", outcome: "10:00:00.000Z" } as const;
const at = (date: string, time: string) => new Date(`${date}T${time}`);

export type PlannedProject = {
  key: string;
  customer: string;
  customerKey: string;
  name: string;
  ownerEmail: string | null;
  externalSourceName: string | null;
  /** The SOA person who raised it; the project's Technical PIC (SOA). */
  technicalPicEmail: string | null;
  createdAt: Date;
};

/** One move of a request's status. The first row of a request (null to Submitted) is written from `createdAt` and `requesterEmail`. */
export type PlannedStep = { from: TicketRequestStatus; to: TicketRequestStatus; at: Date; reason: string | null };

export type PlannedTicket = {
  line: number;
  /** The request code: the sheet's own, or the next free one of the requester's prefix. */
  code: string;
  explicitCode: boolean;
  key: string;
  projectKey: string;
  requesterEmail: string;
  senderEmail: string;
  title: string;
  description: string;
  status: TicketRequestStatus;
  createdAt: Date;
  /** The status moves after Submitted. The sheet's response date is the move to In progress; the note is the reason of the last move. */
  steps: PlannedStep[];
  completedAt: Date | null;
  /** The PIC of Purchasing working it, and the SOA PIC who raised it (when SOA did). */
  picName: string | null;
  picNames: string[];
  raisedByPic: string | null;
};

export type PlannedPic = { team: PicTeam; name: string; key: string };

export type RfqPlan = {
  source: string;
  accounts: { email: string; name: string; role: Role; historyOnly?: true }[];
  /** Prefix per account, for accounts that have none yet. */
  prefixes: { email: string; prefix: string }[];
  pics: PlannedPic[];
  projects: PlannedProject[];
  tickets: PlannedTicket[];
  /** The highest number used per counter scope ("RFQ-S-26"), to raise the counters to. */
  counters: { scope: string; last: number }[];
};

export type PlanContext = {
  /** Prefixes accounts already hold (e-mail to prefix). */
  existingPrefixes?: ReadonlyMap<string, string>;
  /** Counters that already exist (scope to last value), so new codes continue after them. */
  existingCounters?: ReadonlyMap<string, number>;
  /**
   * Codes tickets already have in the database (ticket key to code), when the import is rebuilt. A code is kept while it still belongs to the
   * prefix and year the ticket would get; a ticket whose requester changed gets a new number of its new prefix.
   */
  existingCodes?: ReadonlyMap<string, string>;
};

const shortHash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 16);

/** A stable key per ticket: the mail's Message-ID, or a hash of what identifies the row. Running the import twice finds the same key. */
export function ticketKey(row: TicketRow): string {
  return `hit-rfq:r:${shortHash(row.messageId ?? row.ticketId ?? [row.entryDate, row.senderEmail, nameKey(row.customer), nameKey(row.project)].join("|"))}`;
}
export function projectKeyOf(row: TicketRow): string {
  return `hit-rfq:p:${shortHash([nameKey(row.customer), nameKey(row.project)].join("|"))}`;
}

/**
 * The status moves of a ticket. A response date means the team took it up that day (In progress at 15:00); the outcome (Done, Failed) follows
 * at 17:00 the same day. Without a response date the outcome is set on the day the ticket came in. Both times are assumptions: the sheet has dates only.
 */
export function stepsOf(row: Pick<TicketRow, "entryDate" | "responseDate" | "note">, status: TicketRequestStatus): PlannedStep[] {
  if (status === "SUBMITTED") return [];
  const takenUp = row.responseDate ? at(row.responseDate, HOURS_UTC.response) : null;
  const outcome = at(row.responseDate ?? row.entryDate, HOURS_UTC.outcome);
  if (status === "IN_PROGRESS") return [{ from: "SUBMITTED", to: "IN_PROGRESS", at: takenUp ?? outcome, reason: row.note }];
  if (takenUp) return [{ from: "SUBMITTED", to: "IN_PROGRESS", at: takenUp, reason: null }, { from: "IN_PROGRESS", to: status, at: outcome, reason: row.note }];
  return [{ from: "SUBMITTED", to: status, at: outcome, reason: row.note }];
}

export function planRfqImport(rows: readonly TicketRow[], context: PlanContext = {}, source: string = RFQ_IMPORT_SOURCE): { plan: RfqPlan | null; problems: string[] } {
  const problems: string[] = [];
  for (const row of rows) {
    if (!SENDER_MAPPINGS[row.senderEmail.split("@")[0]!]) problems.push(`Line ${row.line}: the sender ${row.senderEmail} is not mapped to an account (add it to SENDER_MAPPINGS).`);
  }
  const duplicateKeys = new Map<string, number[]>();
  for (const row of rows) duplicateKeys.set(ticketKey(row), [...(duplicateKeys.get(ticketKey(row)) ?? []), row.line]);
  for (const [, lines] of duplicateKeys) if (lines.length > 1) problems.push(`Lines ${lines.join(", ")} are the same ticket twice.`);
  if (problems.length > 0) return { plan: null, problems };

  const mapping = (row: TicketRow) => SENDER_MAPPINGS[row.senderEmail.split("@")[0]!]!;
  const prefixOf = new Map<string, string>(context.existingPrefixes ?? []); // account e-mail to prefix
  const taken = () => new Set(prefixOf.values());
  const newPrefixes = new Set<string>();

  // The sheet's own codes decide the prefix of their sender first ("RFQ-S-260001" is Satrio's "S"). A SOA person shares one login, so the
  // login's prefix is not theirs to give: their sheet codes only keep their numbers (the counter below), and stay as written.
  for (const row of rows.filter((r) => r.ticketId && !mapping(r).soaPic)) {
    const [, prefix] = /^RFQ-([A-Z0-9]{1,3})-/.exec(row.ticketId!)!;
    const account = mapping(row).account.email;
    const held = prefixOf.get(account);
    if (held !== undefined && held !== prefix) problems.push(`Line ${row.line}: ${row.ticketId} uses prefix ${prefix}, but ${account} already has ${held}.`);
    else if (held === undefined) {
      if ([...prefixOf].some(([email, value]) => value === prefix && email !== account)) problems.push(`Line ${row.line}: prefix ${prefix} belongs to someone else.`);
      else if (!CODE_PREFIX_PATTERN.test(prefix!)) problems.push(`Line ${row.line}: prefix ${prefix} is not valid.`);
      else {
        prefixOf.set(account, prefix!);
        newPrefixes.add(account);
      }
    }
  }

  // Everyone else gets a prefix in the order they first appear: one letter of their account's address, more only when the letter is taken.
  const ordered = [...rows].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.line - b.line);
  for (const row of ordered) {
    const account = mapping(row).account.email;
    // A ticket with a code of its own needs no prefix to be numbered; only a ticket whose code is made here does.
    if (row.ticketId || prefixOf.has(account)) continue;
    prefixOf.set(account, pickCodePrefix(account, taken()));
    newPrefixes.add(account);
  }

  const counters = new Map<string, number>(context.existingCounters ?? []);
  const highest = new Map<string, number>();
  const note = (scope: string, value: number) => highest.set(scope, Math.max(highest.get(scope) ?? 0, value));
  for (const row of rows.filter((r) => r.ticketId)) {
    const [, prefix, yy, digits] = /^RFQ-([A-Z0-9]{1,3})-(\d{2})(\d{4,})$/.exec(row.ticketId!)!;
    const scope = codeScope("RFQ", prefix!, yy!);
    counters.set(scope, Math.max(counters.get(scope) ?? 0, Number(digits)));
    note(scope, Number(digits));
  }

  const projects = new Map<string, PlannedProject>();
  const tickets: PlannedTicket[] = [];
  for (const row of ordered) {
    const sender = mapping(row);
    const projectKey = projectKeyOf(row);
    const createdAt = at(row.entryDate, HOURS_UTC.entry);
    if (!projects.has(projectKey)) {
      projects.set(projectKey, {
        key: projectKey,
        customer: row.customer,
        customerKey: nameKey(row.customer),
        name: row.project,
        ownerEmail: sender.owner.kind === "sales" ? sender.owner.email : null,
        externalSourceName: sender.owner.kind === "soa" ? SOA_PROJECT_SOURCE_NAME : null,
        technicalPicEmail: sender.soaPic?.technicalAccount.email ?? null,
        createdAt,
      });
    }

    let code = row.ticketId;
    if (!code) {
      const scope = codeScope("RFQ", prefixOf.get(sender.account.email)!, twoDigitYear(createdAt));
      const kept = context.existingCodes?.get(ticketKey(row));
      if (kept && kept.startsWith(scope) && /^\d{4,}$/.test(kept.slice(scope.length))) {
        code = kept;
        note(scope, Number(kept.slice(scope.length)));
      } else {
        const next = (counters.get(scope) ?? 0) + 1;
        counters.set(scope, next);
        note(scope, next);
        code = formatCode(scope, next);
      }
    }
    const status = TICKET_STATUSES[row.statusLabel];
    const steps = stepsOf(row, status);
    // "Gita & Soraya" is two people but a request has one PIC: the first is assigned and the whole text is kept in the description.
    const description = [`Imported from the ${source}.`, `Sender: ${row.senderEmail}.`, row.pics.length > 1 ? `PIC in the tracker: ${row.pics.join(" & ")}.` : null].filter(Boolean).join(" ");
    tickets.push({
      line: row.line,
      code,
      explicitCode: row.ticketId !== null,
      key: ticketKey(row),
      projectKey,
      requesterEmail: sender.account.email,
      senderEmail: row.senderEmail,
      title: row.project,
      description,
      status,
      createdAt,
      steps,
      completedAt: status === "COMPLETED" ? steps.at(-1)!.at : null,
      picName: row.pics[0] ?? null,
      picNames: row.pics,
      raisedByPic: sender.soaPic?.name ?? null,
    });
  }
  const codes = tickets.map((t) => t.code);
  if (new Set(codes).size !== codes.length) return { plan: null, problems: ["Two tickets would get the same request code."] };
  if (problems.length > 0) return { plan: null, problems };

  const accounts = new Map<string, { email: string; name: string; role: Role; historyOnly?: true }>();
  for (const row of rows) {
    accounts.set(mapping(row).account.email, mapping(row).account);
    const technical = mapping(row).soaPic?.technicalAccount;
    if (technical) accounts.set(technical.email, technical);
  }
  const pics = new Map<string, PlannedPic>();
  for (const ticket of tickets) {
    for (const name of ticket.picNames) pics.set(`PURCHASING:${nameKey(name)}`, { team: "PURCHASING", name, key: nameKey(name) });
    if (ticket.raisedByPic) pics.set(`SOA:${nameKey(ticket.raisedByPic)}`, { team: "SOA", name: ticket.raisedByPic, key: nameKey(ticket.raisedByPic) });
  }

  return {
    problems: [],
    plan: {
      source,
      accounts: [...accounts.values()],
      prefixes: [...newPrefixes].filter((email) => prefixOf.has(email)).map((email) => ({ email, prefix: prefixOf.get(email)! })),
      pics: [...pics.values()],
      projects: [...projects.values()],
      tickets,
      counters: [...highest].map(([scope, last]) => ({ scope, last })),
    },
  };
}
