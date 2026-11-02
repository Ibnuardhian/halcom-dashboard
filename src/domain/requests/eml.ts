import type { MailtoInput } from "./mailto";

const CRLF = "\r\n";

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** RFC 2047: a subject with any character outside ASCII (or none at all) goes in encoded words of at most 45 bytes, folded onto continuation lines. */
function encodeSubject(subject: string): string {
  const words: string[] = [];
  let chunk = "";
  for (const char of subject) {
    if (new TextEncoder().encode(chunk + char).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  // The first word starts on a folded line too, so "Subject:" plus a 72-character word stays under 78 characters.
  return words.map((word) => `${CRLF} =?UTF-8?B?${base64(word)}?=`).join("");
}

/**
 * An `.eml` file that Outlook opens as an unsent draft (`X-Unsent: 1`) with To, Cc, subject and the whole text filled in. Unlike a MailTo
 * link it has no length limit, so a long request text arrives complete. The application still sends nothing.
 */
export function buildEml({ to, cc, subject, body }: MailtoInput): string {
  const list = (addresses: readonly string[]) => addresses.map((address) => address.trim()).filter(Boolean).join(", ");
  const headers = ["X-Unsent: 1"];
  if (list(to)) headers.push(`To: ${list(to)}`);
  if (list(cc)) headers.push(`Cc: ${list(cc)}`);
  headers.push(`Subject:${encodeSubject(subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
  const encoded = base64(body.replace(/\r?\n/g, CRLF)).match(/.{1,76}/g) ?? [];
  return headers.join(CRLF) + CRLF + CRLF + encoded.join(CRLF) + CRLF;
}
