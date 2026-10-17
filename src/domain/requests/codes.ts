import type { RequestType } from "./types";

/** Business time zone used for the two-digit year in request codes. */
export const CODE_TIME_ZONE = "Asia/Jakarta";

/**
 * Initials taken from the requester's email address. The part before "@" is split on `.`, `_`,
 * `-` and `+`: "ibnu.ardhian" gives "IA" and "budi.s.p" gives "BSP" (at most three letters).
 * An address with one part uses its first two letters: "sales" gives "SA".
 */
export function initialsFromEmail(email: string): string {
  const local = email.trim().split("@")[0] ?? "";
  const parts = local.split(/[._+-]+/).filter((part) => /^[a-z0-9]/i.test(part));
  const letters =
    parts.length >= 2 ? parts.slice(0, 3).map((part) => part[0]!) : [...(parts[0] ?? "").replace(/[^a-z0-9]/gi, "")].slice(0, 2);
  const initials = letters.join("").toUpperCase();
  return initials === "" ? "XX" : initials;
}

/** Two-digit year in the business time zone, so a request created at 23:30 on 31 Dec is not dated the next year. */
export function twoDigitYear(date: Date, timeZone: string = CODE_TIME_ZONE): string {
  const year = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date);
  return year.slice(-2);
}

/**
 * Counter key. Request sequences restart per type, per set of initials and per year. Project codes
 * (`PRJ-001`) run in one unbroken sequence, as in the sales export.
 */
export function codeScope(prefix: RequestType | "PRJ", initials: string, yy: string): string {
  return prefix === "PRJ" ? "PRJ-" : `${prefix}-${initials}-${yy}`;
}

/** `RFQ-IA-260001`: scope plus a zero-padded counter of at least `width` digits (four for requests, three for projects). */
export function formatCode(scope: string, sequence: number, width = 4): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError("Sequence must be a positive integer.");
  return `${scope}${String(sequence).padStart(width, "0")}`;
}

/** `PRJ-007`. */
export const PROJECT_CODE_WIDTH = 3;
