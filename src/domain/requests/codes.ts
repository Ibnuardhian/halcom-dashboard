import type { RequestType } from "./types";

/** Business time zone used for the two-digit year in request codes. */
export const CODE_TIME_ZONE = "Asia/Jakarta";

/** The letters of the part before "@" in an e-mail address, upper-cased: "ibnu.ardhian@x.id" gives "IBNUARDHIAN". */
export function nameLetters(email: string): string {
  const local = email.trim().split("@")[0] ?? "";
  return local.replace(/[^a-z]/gi, "").toUpperCase();
}

/** A request code has room for three characters between the type and the year (database check requests_code_format_chk). */
export const CODE_PREFIX_MAX_LENGTH = 3;

/** What `pickCodePrefix` can produce: a letter, then up to two more letters or digits. */
export const CODE_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,2}$/;

/**
 * The prefix a person's request codes carry: one letter, the first letter of the e-mail address ("satrio.akbar@..." gives "S"). A
 * letter another person already uses is not shared: the next person takes the first two letters ("soraya@..." gives "SO"), and
 * the first three if that is taken too. A person keeps the prefix they were given, so a code never changes later.
 * `taken` holds the prefixes already used by other people. An address with no letters is treated as "X".
 * Beyond three letters the code has no room, so a name whose three-letter start is taken gets two letters and a digit ("SOF" taken: "SO2").
 */
export function pickCodePrefix(email: string, taken: ReadonlySet<string>): string {
  const letters = nameLetters(email) || "X";
  for (let length = 1; length <= Math.min(CODE_PREFIX_MAX_LENGTH, letters.length); length += 1) {
    const candidate = letters.slice(0, length);
    if (!taken.has(candidate)) return candidate;
  }
  const stem = letters.slice(0, CODE_PREFIX_MAX_LENGTH - 1);
  for (let n = 2; n <= 9; n += 1) if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
  const first = letters.slice(0, 1);
  for (let n = 10; n <= 99; n += 1) if (!taken.has(`${first}${n}`)) return `${first}${n}`;
  throw new Error("No free code prefix is left for this e-mail address.");
}

/** Two-digit year in the business time zone, so a request created at 23:30 on 31 Dec is not dated the next year. */
export function twoDigitYear(date: Date, timeZone: string = CODE_TIME_ZONE): string {
  const year = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date);
  return year.slice(-2);
}

/**
 * Counter key. Request sequences restart per type, per prefix and per year. Project codes
 * (`HIT-PROJ-001`) run in one unbroken sequence, as in the sales export.
 */
export function codeScope(prefix: RequestType | "PRJ", initials: string, yy: string): string {
  return prefix === "PRJ" ? "HIT-PROJ-" : `${prefix}-${initials}-${yy}`;
}

/** `RFQ-S-260001`: scope plus a zero-padded counter of at least `width` digits (four for requests, three for projects). */
export function formatCode(scope: string, sequence: number, width = 4): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError("Sequence must be a positive integer.");
  return `${scope}${String(sequence).padStart(width, "0")}`;
}

/** `HIT-PROJ-007`. */
export const PROJECT_CODE_WIDTH = 3;
