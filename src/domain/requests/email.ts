import { z } from "zod";
import type { TemplateValues } from "./template";
import { REQUEST_TYPE_LABELS, SUBJECT_TAGS, type RequestType } from "./types";

/**
 * Email text for a request, shown for copy and paste (brief §6.4, delivery decision 2026-10-17:
 * the application never sends mail). Pure functions only: recipients come from server-side
 * configuration and are passed in.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const RECIPIENT_TEXT = z.email();

/** Collapses line breaks and repeated spaces so a value is safe inside a one-line mail header. */
export function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** What the team is asked to do and what it should do next, by type of request: the {{ask}} and {{next_action}} variables. */
export const INTENT: Record<RequestType, { team: string; ask: string; next: string }> = {
  BOQ: {
    team: "SOA team",
    ask: "Please prepare a BOQ / technical solution for the project below.",
    next: "Review the request, ask Sales for any missing information, then prepare and complete the BOQ.",
  },
  RFQ: {
    team: "Purchasing team",
    ask: "Please provide a quotation / item pricing so we can prepare an offer for the end user.",
    next: "Review the specification and return the quotation or item pricing.",
  },
  PO: {
    team: "Purchasing team",
    ask: "Please proceed with the purchase / PO process for the project below.",
    next: "Review the specification and process the purchase.",
  },
};

export type BodyInput = {
  type: RequestType;
  code: string;
  projectCode: string;
  endUserCompany: string;
  projectName: string;
  title: string;
  description: string;
  /** `YYYY-MM-DD` or null. */
  requiredBy: string | null;
  requesterName: string;
  requesterTeam: string;
  /** Code of the completed BOQ this request was handed over from, if any. */
  sourceCode: string | null;
  /** Authenticated link to the request in the application. */
  link: string;
  /** The team's SLA as written for the team ("2-3") and the date the reply is due (`YYYY-MM-DD`). */
  sla: string;
  dueDate: string | null;
};

export function formatDateText(isoDate: string | null): string {
  const match = isoDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate) : null;
  if (!match) return "Not specified";
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

/**
 * The values a team's email template is filled with. Names and titles are put on one line; the details keep their line
 * breaks; a source BOQ that does not exist is an empty value, which makes the template drop that line.
 */
export function templateValues(input: BodyInput): TemplateValues {
  const intent = INTENT[input.type];
  return {
    request_id: input.code,
    request_type: REQUEST_TYPE_LABELS[input.type],
    type_tag: SUBJECT_TAGS[input.type],
    team: intent.team,
    ask: intent.ask,
    next_action: intent.next,
    project_id: input.projectCode,
    end_user: singleLine(input.endUserCompany),
    project_name: singleLine(input.projectName),
    summary: singleLine(input.title),
    details: input.description.trim() || "-",
    requested_by: singleLine(input.requesterName),
    requester_team: input.requesterTeam,
    needed_by: formatDateText(input.requiredBy),
    sla_days: input.sla,
    due_date: formatDateText(input.dueDate),
    source_request: input.sourceCode ? `${input.sourceCode} (completed)` : "",
    link: input.link,
  };
}

/** Splits a comma/semicolon separated list, normalises, de-duplicates and validates addresses (brief §6.4). */
export function parseRecipients(raw: string | undefined): { addresses: string[]; invalid: string[] } {
  const addresses: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(/[;,]/)) {
    const address = part.trim();
    if (address === "") continue;
    if (!RECIPIENT_TEXT.safeParse(address).success) {
      invalid.push(address);
      continue;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(address);
  }
  return { addresses, invalid };
}

export type RecipientsResult = { ok: true; to: string[]; cc: string[] } | { ok: false; error: string };

type Env = Readonly<Record<string, string | undefined>>;

/**
 * To and Cc for a request type, read from `EMAIL_TO_HITxxx` / `EMAIL_CC_HITxxx`. Missing or invalid
 * configuration is reported, never replaced by another group's list (brief §6.4).
 */
export function resolveRecipients(type: RequestType, env: Env): RecipientsResult {
  const tag = `HIT${type}`;
  const to = parseRecipients(env[`EMAIL_TO_${tag}`]);
  const cc = parseRecipients(env[`EMAIL_CC_${tag}`]);
  if (to.invalid.length > 0 || cc.invalid.length > 0) {
    const bad = [...to.invalid, ...cc.invalid].join(", ");
    return { ok: false, error: `EMAIL_TO_${tag} / EMAIL_CC_${tag} contain invalid addresses: ${bad}.` };
  }
  if (to.addresses.length === 0) {
    return { ok: false, error: `EMAIL_TO_${tag} is not configured, so the recipients cannot be shown.` };
  }
  // An address in To is not repeated in Cc.
  const toKeys = new Set(to.addresses.map((a) => a.toLowerCase()));
  return { ok: true, to: to.addresses, cc: cc.addresses.filter((a) => !toKeys.has(a.toLowerCase())) };
}
