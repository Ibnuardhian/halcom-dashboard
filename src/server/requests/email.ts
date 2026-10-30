import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import { parseRecipients, resolveRecipients, templateValues, type RecipientsResult } from "@/domain/requests/email";
import { formatSlaRange, type SlaRange } from "@/domain/requests/sla";
import { renderBody, renderSubject } from "@/domain/requests/template";
import type { RequestType } from "@/domain/requests/types";

type Env = Readonly<Record<string, string | undefined>>;

/** The configured public address, without a trailing slash, or null when it is missing or not an http(s) URL. */
export function appBaseUrl(env: Env = process.env): string | null {
  const raw = env["APP_BASE_URL"]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return raw.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export type EmailSource = {
  code: string;
  type: RequestType;
  title: string;
  description: string;
  requiredBy: Date | null;
  project: { code: string; endUserCompany: string; name: string };
  requester: { name: string; role: Role };
  source: { code: string } | null;
};

export type RequestEmail = {
  recipients: RecipientsResult;
  subject: string;
  body: string;
  /** False when APP_BASE_URL is missing, so the body carries a placeholder instead of a link. */
  linkConfigured: boolean;
};

/** The receiving team's template and SLA, and the date a reply is due; they fill the template's variables. */
export type EmailTemplateSource = { subject: string; body: string; sla: SlaRange; dueAt: Date; /** The team's saved To and Cc (empty: the server settings apply). */ to?: string; cc?: string };

/**
 * The To, Cc, subject and body for a request, for the copy-and-paste panel. The subject and text come from the template
 * of the team that receives the request (set by the superadmin). Nothing is sent and nothing is stored: the text is
 * derived from the request each time it is shown.
 */
export function buildRequestEmail(request: EmailSource, template: EmailTemplateSource, env: Env = process.env): RequestEmail {
  const base = appBaseUrl(env);
  const values = templateValues({
    type: request.type,
    code: request.code,
    projectCode: request.project.code,
    endUserCompany: request.project.endUserCompany,
    projectName: request.project.name,
    title: request.title,
    description: request.description,
    requiredBy: request.requiredBy ? request.requiredBy.toISOString().slice(0, 10) : null,
    requesterName: request.requester.name,
    requesterTeam: ROLE_LABELS[request.requester.role],
    sourceCode: request.source?.code ?? null,
    link: base ? `${base}/request/${request.code}` : "(not available: APP_BASE_URL is not configured)",
    sla: formatSlaRange(template.sla),
    // The SLA date is a date in Jakarta time, written the way the rest of the mail writes dates.
    dueDate: new Date(template.dueAt.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });
  return {
    recipients: teamRecipients(template) ?? resolveRecipients(request.type, env),
    subject: renderSubject(template.subject, values),
    body: renderBody(template.body, values),
    linkConfigured: base !== null,
  };
}

/** The To and Cc saved for the team in the SLA module; null while none is saved, so the server's EMAIL_TO_HIT* settings apply. */
function teamRecipients(template: EmailTemplateSource): RecipientsResult | null {
  const to = parseRecipients(template.to);
  if (to.addresses.length === 0) return null;
  const toKeys = new Set(to.addresses.map((address) => address.toLowerCase()));
  return { ok: true, to: to.addresses, cc: parseRecipients(template.cc).addresses.filter((address) => !toKeys.has(address.toLowerCase())) };
}
