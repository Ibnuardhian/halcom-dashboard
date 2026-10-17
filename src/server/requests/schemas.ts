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
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    return date;
  });

const required = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

const submissionKey = z.string().trim().min(8).max(100).nullish().transform((value) => value || null);

export const createProjectSchema = z.object({
  endUserCompany: required("End-user company", 120),
  name: required("Project name", 120),
  description: optionalText(2000),
  targetDate: optionalDate,
  submissionKey,
});

export const createRequestSchema = z.object({
  projectId: z.uuid("Choose a project."),
  type: z.enum(REQUEST_TYPES, "Choose a request type."),
  title: required("Summary", 150),
  description: optionalText(4000),
  requiredBy: optionalDate,
  submissionKey,
});

export const handoverSchema = z.object({
  sourceId: z.uuid(),
  targetType: z.enum(HANDOVER_TYPES, "Choose RFQ or PO."),
});

export const statusChangeSchema = z.object({
  requestId: z.uuid(),
  to: z.enum(REQUEST_STATUSES),
  reason: optionalText(500),
});

export const uuidSchema = z.uuid();
