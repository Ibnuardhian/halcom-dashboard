import { isProgress, isTrackStatus, PROGRESS_LABELS, TRACK_STATUS_LABELS } from "./progress";

/**
 * Commercial project fields Sales may change on the projects they own (admins on any project). Stage and status are
 * not here: they decide whether requests can be added, so they stay a deliberate, separate change.
 * The server rejects any key that is not listed (same approach as the technical fields in fields.ts).
 */
export const COMMERCIAL_FIELDS = {
  progress: { label: "Progress", kind: "progress" },
  trackStatus: { label: "Status", kind: "track-status" },
  estimatedValue: { label: "Estimated PO value", kind: "amount" },
  probability: { label: "Probability (%)", kind: "percent-int" },
  targetMargin: { label: "Target margin (%)", kind: "percent" },
  quoteReleasedAt: { label: "Quote released", kind: "date" },
  targetDate: { label: "Target closing", kind: "date" },
} as const;

export type CommercialField = keyof typeof COMMERCIAL_FIELDS;

export const COMMERCIAL_KEYS = Object.keys(COMMERCIAL_FIELDS) as CommercialField[];

export function isCommercialField(key: string): key is CommercialField {
  return Object.prototype.hasOwnProperty.call(COMMERCIAL_FIELDS, key);
}

/** A parsed value: a number, a `YYYY-MM-DD` date string, or null for "no value". */
export type CommercialValue = number | string | null;

export type ParsedCommercial = { ok: true; value: CommercialValue } | { ok: false; message: string };

/** Turns what a form submitted (text) into the stored value of one field. Blank means "no value". */
export function parseCommercialValue(field: CommercialField, raw: string | null | undefined): ParsedCommercial {
  const text = (raw ?? "").trim().replace(/\s+/g, "");
  const label = COMMERCIAL_FIELDS[field].label;
  if (text === "") return { ok: true, value: null };
  switch (COMMERCIAL_FIELDS[field].kind) {
    case "progress":
      return isProgress(text) ? { ok: true, value: text } : { ok: false, message: `Choose a ${label.toLowerCase()} from the list.` };
    case "track-status":
      return isTrackStatus(text) ? { ok: true, value: text } : { ok: false, message: `Choose a ${label.toLowerCase()} from the list.` };
    case "amount": {
      // Indonesian thousands separators ("1.200.000.000") are accepted next to plain digits.
      const digits = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replaceAll(".", "") : text;
      if (!/^\d{1,16}(\.\d{1,2})?$/.test(digits)) return { ok: false, message: `${label} must be a number of zero or more.` };
      return { ok: true, value: Number(digits) };
    }
    case "percent-int": {
      if (!/^\d{1,3}$/.test(text) || Number(text) > 100) return { ok: false, message: `${label} must be a whole number from 0 to 100.` };
      return { ok: true, value: Number(text) };
    }
    case "percent": {
      const normal = text.replace(",", ".");
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(normal) || Number(normal) > 100) return { ok: false, message: `${label} must be from 0 to 100 (up to two decimals).` };
      return { ok: true, value: Number(normal) };
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) return { ok: false, message: `${label} must be a valid date.` };
      return { ok: true, value: text };
    }
  }
}

/** The text a stored value is logged as, so the change log reads the same for every field ("30% - Propose", not QUALIFY). */
export function commercialLogText(value: CommercialValue, field?: CommercialField): string | null {
  if (value === null) return null;
  if (field === "progress" && isProgress(value)) return PROGRESS_LABELS[value];
  if (field === "trackStatus" && isTrackStatus(value)) return TRACK_STATUS_LABELS[value];
  return String(value);
}

export type CommercialChange = { field: CommercialField; from: string | null; to: string | null };

/** The fields whose value really changes; unchanged and unsubmitted fields write nothing. */
export function diffCommercial(
  current: Readonly<Record<CommercialField, CommercialValue>>,
  submitted: Readonly<Partial<Record<CommercialField, CommercialValue>>>,
): CommercialChange[] {
  const changes: CommercialChange[] = [];
  for (const field of COMMERCIAL_KEYS) {
    if (!(field in submitted)) continue;
    const from = commercialLogText(current[field], field);
    const to = commercialLogText(submitted[field] ?? null, field);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}
