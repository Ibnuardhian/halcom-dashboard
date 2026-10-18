import { COMMERCIAL_FIELDS, isCommercialField } from "./commercial";

/**
 * Project fields a technical person (SOA) may change, and the label each one shows in the interface
 * and in the change log. Commercial fields (values, probability, stage, status) are deliberately not
 * listed: the server rejects any key that is not here (docs/requirements/RBAC.md, field-level rules).
 * Current and next action are not here: they are a comment-like feed (actions.ts).
 */
export const PROJECT_EDITABLE_FIELDS = {
  requirement: { label: "Requirement", group: "technical" },
  assessmentStatus: { label: "Assessment", group: "technical" },
  solutionProposed: { label: "Solution proposed", group: "technical" },
  architectureStatus: { label: "Architecture", group: "technical" },
  sizingStatus: { label: "Sizing", group: "technical" },
  boqStatus: { label: "BOQ", group: "technical" },
  quotationStatus: { label: "Quotation", group: "technical" },
  proposalStatus: { label: "Proposal", group: "technical" },
  pocStatus: { label: "POC", group: "technical" },
  scopeEstimate: { label: "Scope estimate", group: "technical" },
  technicalChallenge: { label: "Technical challenge", group: "technical" },
  technicalBlocker: { label: "Technical blocker", group: "technical" },
  technicalNotes: { label: "Technical notes", group: "technical" },
} as const;

export type ProjectEditableField = keyof typeof PROJECT_EDITABLE_FIELDS;

export const PROJECT_EDITABLE_KEYS = Object.keys(PROJECT_EDITABLE_FIELDS) as ProjectEditableField[];

export const TECHNICAL_FIELDS = PROJECT_EDITABLE_KEYS;

export function isEditableField(key: string): key is ProjectEditableField {
  return Object.prototype.hasOwnProperty.call(PROJECT_EDITABLE_FIELDS, key);
}

/** The change-log names of the three PIC slots, which only a superadmin moves. */
const OWNER_LABELS: Record<string, string> = {
  salesOwner: "Sales PIC",
  technicalPic: "Technical PIC (SOA)",
  purchasingPic: "Purchasing PIC",
  principal: "Principal",
  solution: "Solution",
};

/** A field label for a stored change; an unknown key (a field removed later) is shown as it was stored. */
export function fieldLabel(key: string): string {
  if (key in OWNER_LABELS) return OWNER_LABELS[key]!;
  if (isEditableField(key)) return PROJECT_EDITABLE_FIELDS[key].label;
  return isCommercialField(key) ? COMMERCIAL_FIELDS[key].label : key;
}

/** Trimmed text; blank means "no value" (null), so clearing a field is a real change. */
export function normaliseFieldValue(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export type FieldChange = { field: ProjectEditableField; from: string | null; to: string | null };

/**
 * The fields whose value actually changes. Fields not mentioned in `submitted` are left alone;
 * a field submitted with the value it already has is not a change, so it produces no log entry.
 */
export function diffFields(
  current: Readonly<Record<ProjectEditableField, string | null>>,
  submitted: Readonly<Partial<Record<ProjectEditableField, string | null>>>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of PROJECT_EDITABLE_KEYS) {
    if (!(field in submitted)) continue;
    const from = normaliseFieldValue(current[field]);
    const to = normaliseFieldValue(submitted[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}
