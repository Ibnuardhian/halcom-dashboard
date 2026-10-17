import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import { composeBody, composeSubject, resolveRecipients, type RecipientsResult } from "@/domain/requests/email";
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

/**
 * The To, Cc, subject and body for a request, for the copy-and-paste panel. Nothing is sent and
 * nothing is stored: the text is derived from the request each time it is shown.
 */
export function buildRequestEmail(request: EmailSource, env: Env = process.env): RequestEmail {
  const base = appBaseUrl(env);
  return {
    recipients: resolveRecipients(request.type, env),
    subject: composeSubject({
      type: request.type,
      endUserCompany: request.project.endUserCompany,
      projectName: request.project.name,
    }),
    body: composeBody({
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
    }),
    linkConfigured: base !== null,
  };
}
