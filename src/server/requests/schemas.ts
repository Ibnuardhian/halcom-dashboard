import { z } from "zod";
import { HANDOVER_TYPES, REQUEST_STATUSES } from "@/domain/requests/status";

import { REQUEST_TYPES } from "@/domain/requests/types";

/** Empty form fields arrive as "" or null; both mean "not provided". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** `YYYY-MM-DD` from a date input, checked as a real calendar date. */
const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!match || !date || date.toISOString().slice(0, 10) !== value) {
      ctx.addIssue({ code: "custom", message: "Masukkan tanggal yang valid." });
      return z.NEVER;
    }
    return date;
  });

const required = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} wajib diisi.`)
    .max(max, `${label} maksimal ${max} karakter.`);

const submissionKey = z.string().trim().min(8).max(100).nullish().transform((value) => value || null);

/** The request fields shared by the stand-alone request form and the "new project with a request" form. */
const requestBody = {
  type: z.enum(REQUEST_TYPES, "Pilih jenis request."),
  title: required("Summary", 150),
  description: optionalText(4000),
  requiredBy: optionalDate,
};

export const createProjectSchema = z.object({
  endUserCompany: required("End-user company", 120),
  name: required("Project name", 120),
  description: optionalText(2000),
  targetDate: optionalDate,
  // Where the project came from. Absent means Internal Sales; the rules live in normaliseSource (src/domain/projects/source.ts).
  sourceType: optionalText(40),
  externalSourceName: optionalText(4000),
  externalContact: optionalText(4000),
  externalReference: optionalText(4000),
  sourceNotes: optionalText(4000),
  // The salesperson an Internal Sales project belongs to, chosen by SOA. Ignored for anyone else: a salesperson always owns their own.
  salesOwnerId: optionalText(40),
  // Commercial details Sales may already know; kept as text and parsed with the same rules as the project page.
  progress: optionalText(40),
  trackStatus: optionalText(40),
  estimatedValue: optionalText(40),
  targetMargin: optionalText(40),
  targetMarginValue: optionalText(40),
  // A BOQ, RFQ or PO raised together with the project; null when Sales add no request yet.
  request: z
    .object(requestBody)
    .nullish()
    .transform((value) => value ?? null),
  submissionKey,
});

export const createRequestSchema = z.object({
  projectId: z.uuid("Choose a project."),
  ...requestBody,
  submissionKey,
});

export const phaseSchema = z.object({
  projectId: z.uuid(),
  // "" clears the label (work has not reached a phase yet).
  phase: z.string().trim().max(40, "Pilih SOA phase yang tersedia.").transform((value) => (value === "" ? null : value)),
});

export const handoverSchema = z.object({
  sourceId: z.uuid(),
  targetType: z.enum(HANDOVER_TYPES, "Pilih RFQ atau PO."),
});

export const stopFlowSchema = z.object({ sourceId: z.uuid(), note: optionalText(500) });

export const statusChangeSchema = z.object({
  requestId: z.uuid(),
  to: z.enum(REQUEST_STATUSES),
  reason: optionalText(500),
});

/** Sales ask for a revision of a completed BOQ; the reason is the change the customer asked for. */
export const revisionSchema = z.object({ requestId: z.uuid(), reason: z.string().trim().min(1, "Tuliskan apa yang perlu diubah.").max(500) });

/** A superadmin sets the creation and completion day of a request by hand: a calendar day (YYYY-MM-DD, no time), read as Jakarta midnight. */
const dayInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Masukkan tanggal yang valid.")
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00+07:00`);
    if (Number.isNaN(date.getTime()) || new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 10) !== value) {
      ctx.addIssue({ code: "custom", message: "Masukkan tanggal yang valid." });
      return z.NEVER;
    }
    // A year typed short ("0261" for 2026) would give a turnaround of centuries, so only 2000 to 2100 is taken.
    if (date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) {
      ctx.addIssue({ code: "custom", message: "Tahun harus antara 2000 dan 2100." });
      return z.NEVER;
    }
    return date;
  });
export const requestDatesSchema = z.object({
  requestId: z.uuid(),
  createdAt: dayInput,
  completedAt: z.string().trim().nullish().transform((value) => (value ? value : null)).pipe(dayInput.nullable()),
  // An account id, or "pic:<id>" for a SOA PIC who raised the request through the shared SOA login.
  requesterId: z.string().trim().nullish().transform((value) => (value ? value : undefined)).pipe(z.string().regex(/^(pic:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Pilih pemohon yang valid.").optional()),
});

export const uuidSchema = z.uuid();
