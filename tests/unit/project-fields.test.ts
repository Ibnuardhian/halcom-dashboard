import { describe, expect, it } from "vitest";
import { can } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import {
  ACTION_KIND_LABELS,
  isActionKind,
  LATEST_CURRENT_COUNT,
  summariseActions,
  type ProjectActionKind,
} from "@/domain/projects/actions";
import {
  diffFields,
  fieldLabel,
  isEditableField,
  normaliseFieldValue,
  PROJECT_EDITABLE_FIELDS,
  PROJECT_EDITABLE_KEYS,
  TECHNICAL_FIELDS,
  type ProjectEditableField,
} from "@/domain/projects/fields";

const EMPTY = Object.fromEntries(PROJECT_EDITABLE_KEYS.map((key) => [key, null])) as Record<ProjectEditableField, string | null>;

describe("editable project fields", () => {
  it("lists only technical fields, never a commercial one and never the current / next action feed", () => {
    expect(TECHNICAL_FIELDS).toEqual(PROJECT_EDITABLE_KEYS);
    for (const forbidden of ["estimatedValue", "probability", "finalValue", "stage", "status", "salesOwnerId", "wonDate", "competitor", "currentAction", "nextAction"]) {
      expect(isEditableField(forbidden), forbidden).toBe(false);
    }
  });

  it("writes BOQ, not BOM, in every label", () => {
    expect(fieldLabel("boqStatus")).toBe("BOQ");
    for (const key of PROJECT_EDITABLE_KEYS) expect(PROJECT_EDITABLE_FIELDS[key].label).not.toMatch(/BOM/i);
  });

  it("shows an unknown stored field key as it was stored", () => {
    expect(fieldLabel("removedField")).toBe("removedField");
    expect(isEditableField("toString")).toBe(false); // not fooled by inherited object properties
  });

  it("treats blank text as no value", () => {
    expect(normaliseFieldValue("  hello \n")).toBe("hello");
    expect(normaliseFieldValue("   ")).toBeNull();
    expect(normaliseFieldValue(null)).toBeNull();
    expect(normaliseFieldValue(undefined)).toBeNull();
  });
});

describe("diffFields", () => {
  const current = { ...EMPTY, sizingStatus: "In progress", technicalNotes: "Sized for 400 users" };

  it("reports only fields whose value really changes", () => {
    expect(diffFields(current, { sizingStatus: "Done", technicalNotes: "Sized for 400 users" })).toEqual([
      { field: "sizingStatus", from: "In progress", to: "Done" },
    ]);
  });

  it("leaves fields that were not submitted alone", () => {
    expect(diffFields(current, { pocStatus: "Planned" })).toEqual([{ field: "pocStatus", from: null, to: "Planned" }]);
    expect(diffFields(current, {})).toEqual([]);
  });

  it("ignores whitespace-only differences, and logs clearing a field as a change to empty", () => {
    expect(diffFields(current, { sizingStatus: "  In progress  " })).toEqual([]);
    expect(diffFields(current, { requirement: "   " })).toEqual([]); // empty to empty is nothing
    expect(diffFields(current, { sizingStatus: "" })).toEqual([{ field: "sizingStatus", from: "In progress", to: null }]);
  });

  it("returns changes in the order of the field list, not the order submitted", () => {
    const changes = diffFields(EMPTY, { technicalNotes: "b", requirement: "a" });
    expect(changes.map((c) => c.field)).toEqual(["requirement", "technicalNotes"]);
  });
});

describe("current and next action feed", () => {
  const entry = (id: string, kind: ProjectActionKind) => ({ id, kind });

  it("knows its two kinds and their labels", () => {
    expect(ACTION_KIND_LABELS).toEqual({ CURRENT: "Current action", NEXT: "Next action" });
    expect(isActionKind("CURRENT")).toBe(true);
    expect(isActionKind("NEXT")).toBe(true);
    expect(isActionKind("DONE")).toBe(false);
    expect(isActionKind(undefined)).toBe(false);
  });

  it("highlights the last two current actions and only the newest next action (feed is newest first)", () => {
    const feed = [entry("n2", "NEXT"), entry("c3", "CURRENT"), entry("c2", "CURRENT"), entry("n1", "NEXT"), entry("c1", "CURRENT")];

    const { current, next } = summariseActions(feed);

    expect(LATEST_CURRENT_COUNT).toBe(2);
    expect(current.map((e) => e.id)).toEqual(["c3", "c2"]);
    expect(next?.id).toBe("n2");
  });

  it("copes with a feed that has only one kind, or nothing", () => {
    expect(summariseActions([entry("c1", "CURRENT")])).toEqual({ current: [entry("c1", "CURRENT")], next: null });
    expect(summariseActions([entry("n1", "NEXT")])).toEqual({ current: [], next: entry("n1", "NEXT") });
    expect(summariseActions([])).toEqual({ current: [], next: null });
  });
});

describe("who may edit technical fields and post updates", () => {
  it("is SOA, admin and superadmin only; Sales, Purchasing, Finance and Management stay read-only", () => {
    for (const role of ROLES) {
      const allowed = ["SOA", "ADMIN", "SUPERADMIN"].includes(role);
      expect(can(role, "projects.edit.technical"), role).toBe(allowed);
      expect(can(role, "projects.post-update"), role).toBe(allowed);
    }
  });
});
