import { singleLine } from "./email";
import { DEFAULT_SLA, type SlaRange } from "./sla";

/**
 * Email templates: the superadmin writes the subject and text each team's emails start from, with {{variables}} that are
 * filled in from the request. Pure functions; the template itself is stored per team (SOA, Purchasing).
 */
export const TEMPLATE_VARIABLES = [
  { name: "request_id", label: "Request ID", example: "RFQ-S-260001" },
  { name: "request_type", label: "Jenis request", example: "RFQ (Request for Quotation)" },
  { name: "type_tag", label: "Tag subjek untuk jenis request", example: "[HITRFQ]" },
  { name: "team", label: "Tim penerima", example: "Purchasing team" },
  { name: "ask", label: "Yang diminta dari tim", example: "Please provide a quotation / item pricing …" },
  { name: "next_action", label: "Tindakan berikutnya yang diharapkan", example: "Review the specification and return the quotation …" },
  { name: "project_id", label: "Project ID", example: "HIT-PROJ-004" },
  { name: "end_user", label: "Perusahaan end user", example: "PT ABC" },
  { name: "project_name", label: "Nama project", example: "CCTV AI" },
  { name: "summary", label: "Ringkasan request", example: "Pricing for 40 cameras" },
  { name: "details", label: "Detail request", example: "Model list attached in the project folder." },
  { name: "requested_by", label: "Diminta oleh (nama)", example: "Ibnu Ardhian" },
  { name: "requester_team", label: "Tim peminta", example: "Sales" },
  { name: "needed_by", label: "Dibutuhkan pada", example: "5 Nov 2026" },
  { name: "sla_days", label: "SLA dalam hari kerja, sesuai pengaturan tim", example: "2-3" },
  { name: "due_date", label: "Balas sebelum (batas SLA)", example: "22 Oct 2026" },
  { name: "source_request", label: "BOQ asal serah terima (baris dilewati bila kosong)", example: "BOQ-S-260001 (completed)" },
  { name: "link", label: "Tautan ke request", example: "http://localhost:3000/request/RFQ-S-260001" },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]["name"];
export type TemplateValues = Record<TemplateVariable, string>;

const KNOWN = new Set<string>(TEMPLATE_VARIABLES.map((variable) => variable.name));
const VARIABLE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export const SUBJECT_MAX_LENGTH = 200;
export const BODY_MAX_LENGTH = 4000;

/** The names used in a template, in order of first use. */
export function variablesIn(template: string): string[] {
  return [...new Set([...template.matchAll(VARIABLE)].map((match) => match[1]!))];
}

/**
 * What is wrong with a template, in words. The subject must carry the Request ID: a reply keeps the subject, so that is
 * how SOA and Purchasing answer with the ID. Unknown variables would reach the mail as literal braces, so they are refused.
 */
export function validateTemplate(subject: string, body: string): string[] {
  const problems: string[] = [];
  if (subject.trim() === "") problems.push("Subjek wajib diisi.");
  if (body.trim() === "") problems.push("Isi email wajib diisi.");
  if (subject.length > SUBJECT_MAX_LENGTH) problems.push(`Subjek paling banyak ${SUBJECT_MAX_LENGTH} karakter.`);
  if (body.length > BODY_MAX_LENGTH) problems.push(`Isi email paling banyak ${BODY_MAX_LENGTH} karakter.`);
  const unknown = [...variablesIn(subject), ...variablesIn(body)].filter((name) => !KNOWN.has(name));
  if (unknown.length > 0) problems.push(`Variabel tidak dikenal: ${[...new Set(unknown)].map((name) => `{{${name}}}`).join(", ")}.`);
  if (!variablesIn(subject).includes("request_id")) problems.push("Subjek wajib memuat {{request_id}}, supaya balasan membawa Request ID.");
  return problems;
}

const fill = (line: string, values: TemplateValues): string => line.replace(VARIABLE, (whole, name: string) => (KNOWN.has(name) ? values[name as TemplateVariable] : whole));

/** The subject on one line, with every variable filled in. */
export function renderSubject(template: string, values: TemplateValues): string {
  return singleLine(fill(template, values));
}

/**
 * The text with every variable filled in. A line that uses a variable which is empty for this request (for example the
 * source BOQ of a request that was not handed over) is left out, so no empty label remains.
 */
export function renderBody(template: string, values: TemplateValues): string {
  return template
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => ![...line.matchAll(VARIABLE)].some((match) => KNOWN.has(match[1]!) && values[match[1] as TemplateVariable] === ""))
    .map((line) => fill(line, values))
    .join("\n");
}

export type TeamTemplate = { subject: string; body: string; sla: SlaRange };

const DEFAULT_BODY = [
  "Dear {{team}},",
  "",
  "{{ask}}",
  "",
  "Request ID   : {{request_id}}",
  "Project ID   : {{project_id}}",
  "End user     : {{end_user}}",
  "Project      : {{project_name}}",
  "Request type : {{request_type}}",
  "Requested by : {{requested_by}} ({{requester_team}})",
  "Needed by    : {{needed_by}}",
  "Reply by     : {{due_date}} (SLA {{sla_days}} working days)",
  "Source BOQ   : {{source_request}}",
  "",
  "Summary",
  "{{summary}}",
  "",
  "Details",
  "{{details}}",
  "",
  "Expected next action: {{next_action}}",
  "Request link: {{link}}",
  "",
  "Please reply to this email and keep the Request ID {{request_id}} in the subject, and write it at the top of your reply, so that your answer can be matched to this request.",
  "",
  "Thank you,",
  "{{requested_by}}",
].join("\n");

/** What each team's email looks like until the superadmin changes it. */
export const DEFAULT_TEMPLATES: Record<"SOA" | "PURCHASING", TeamTemplate> = {
  SOA: { subject: "{{type_tag}} {{end_user}} - {{project_name}} [{{request_id}}]", body: DEFAULT_BODY, sla: DEFAULT_SLA },
  PURCHASING: { subject: "{{type_tag}} {{end_user}} - {{project_name}} [{{request_id}}]", body: DEFAULT_BODY, sla: DEFAULT_SLA },
};

export const TEMPLATE_TEAMS = ["SOA", "PURCHASING"] as const;
export type TemplateTeam = (typeof TEMPLATE_TEAMS)[number];

/** Sample values for the preview on the settings page. */
export const SAMPLE_VALUES: TemplateValues = Object.fromEntries(TEMPLATE_VARIABLES.map((variable) => [variable.name, variable.example])) as TemplateValues;
