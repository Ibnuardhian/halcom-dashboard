/**
 * Windows hands a mailto: link to the mail program as a command line, and Outlook ignores what is past about 2000
 * characters, so a longer link would silently lose the end of the text.
 */
export const MAILTO_MAX_LENGTH = 1900;

export type MailtoInput = { to: readonly string[]; cc: readonly string[]; subject: string; body: string };

export type Mailto = {
  href: string;
  /** False when the text was too long for a link: the draft then has the recipients and subject, and the text is copied by hand. */
  bodyIncluded: boolean;
};

/** Line breaks of an email are CRLF; everything else is percent-encoded so addresses, "&" and "#" cannot break the link. */
const encode = (text: string) => encodeURIComponent(text.replace(/\r?\n/g, "\r\n"));

/**
 * A `mailto:` link that opens a new message with To, Cc, subject and text filled in (RFC 6068). The application
 * itself sends nothing: the person reviews the draft in Outlook and sends it from there.
 */
export function buildMailto({ to, cc, subject, body }: MailtoInput): Mailto {
  const recipients = to.map((address) => address.trim()).filter(Boolean).join(",");
  const parts = [];
  const copies = cc.map((address) => address.trim()).filter(Boolean).join(",");
  if (copies) parts.push(`cc=${encode(copies)}`);
  parts.push(`subject=${encode(subject)}`);
  const withoutBody = `mailto:${recipients}?${parts.join("&")}`;
  const withBody = `${withoutBody}&body=${encode(body)}`;
  return withBody.length <= MAILTO_MAX_LENGTH ? { href: withBody, bodyIncluded: true } : { href: withoutBody, bodyIncluded: false };
}
