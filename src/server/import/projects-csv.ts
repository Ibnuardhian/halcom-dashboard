import { cleanName, parseProjectStatus, parseStage, type ProjectStage, type ProjectStatusValue } from "@/domain/projects/pipeline";
import type { Role } from "@/domain/access/roles";
import { parseCsv, recordsWithHeader } from "./csv";

/** One project of the sales export, validated and typed. Empty cells are null. */
export type ProjectImportRow = {
  code: string;
  customer: string;
  name: string;
  industry: string | null;
  location: string | null;
  salesPic: string;
  technicalPic: string | null;
  principal: string | null;
  solution: string | null;
  description: string | null;
  estimatedValue: number | null;
  probability: number | null;
  targetClosing: Date | null;
  stage: ProjectStage;
  status: ProjectStatusValue;
  competitor: string | null;
  competitionStatus: string | null;
  requirement: string | null;
  assessmentStatus: string | null;
  solutionProposed: string | null;
  architectureStatus: string | null;
  sizingStatus: string | null;
  boqStatus: string | null;
  quotationStatus: string | null;
  proposalStatus: string | null;
  pocStatus: string | null;
  technicalChallenge: string | null;
  technicalBlocker: string | null;
  technicalNotes: string | null;
  currentAction: string | null;
  nextAction: string | null;
  scopeEstimate: string | null;
  lostReason: string | null;
  lostNotes: string | null;
  wonDate: Date | null;
  finalValue: number | null;
  stakeholders: string | null;
  customFields: unknown;
};

export type ProjectsCsvResult = { rows: ProjectImportRow[]; problems: string[] };

const REQUIRED_COLUMNS = [
  "Project ID",
  "Customer",
  "Project Name",
  "Sales PIC",
  "Technical PIC",
  "Principal",
  "Solution",
  "Project Description",
  "Estimated Value",
  "Probability",
  "Target Closing",
  "Stage",
  "Status",
  "Won Date",
  "Final Value",
  "PIC / Stakeholder (raw)",
  "Custom Fields (JSON)",
] as const;

function text(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function parseDate(label: string, value: string | undefined, problems: string[], where: string): Date | null {
  const raw = text(value);
  if (raw === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !date || date.toISOString().slice(0, 10) !== raw) {
    problems.push(`${where}: ${label} "${raw}" is not a valid YYYY-MM-DD date.`);
    return null;
  }
  return date;
}

function parseMoney(label: string, value: string | undefined, problems: string[], where: string): number | null {
  const raw = text(value);
  if (raw === null) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    problems.push(`${where}: ${label} "${raw}" is not a plain non-negative number.`);
    return null;
  }
  return Number(raw);
}

/**
 * Reads the sales export. Problems are collected for the whole file, not just the first one, so a
 * dry run shows everything that needs fixing. A file with any problem imports nothing.
 */
export function parseProjectsCsv(csv: string): ProjectsCsvResult {
  const problems: string[] = [];
  let table: string[][];
  try {
    table = parseCsv(csv);
  } catch (error) {
    return { rows: [], problems: [error instanceof Error ? error.message : "The CSV could not be read."] };
  }
  const header = table[0] ?? [];
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) return { rows: [], problems: [`Missing column(s): ${missing.join(", ")}.`] };

  const { records, problems: shapeProblems } = recordsWithHeader(table);
  problems.push(...shapeProblems);

  const rows: ProjectImportRow[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const code = (record["Project ID"] ?? "").trim();
    const where = code || "A row without a Project ID";
    if (!/^HIT-PROJ-\d{3,}$/.test(code)) problems.push(`${where}: Project ID must look like HIT-PROJ-001.`);
    if (seen.has(code)) problems.push(`${where}: duplicate Project ID in the file.`);
    seen.add(code);

    const customer = text(record["Customer"]);
    const name = text(record["Project Name"]);
    if (!customer) problems.push(`${where}: Customer is required.`);
    if (!name) problems.push(`${where}: Project Name is required.`);
    // Every project needs a Sales owner (the database requires one).
    const salesPic = text(record["Sales PIC"]);
    if (!salesPic) problems.push(`${where}: Sales PIC is required.`);

    const stage = parseStage(record["Stage"] ?? "");
    const status = parseProjectStatus(record["Status"] ?? "");
    if (!stage) problems.push(`${where}: unknown Stage "${record["Stage"]}".`);
    if (!status) problems.push(`${where}: unknown Status "${record["Status"]}".`);

    const estimatedValue = parseMoney("Estimated Value", record["Estimated Value"], problems, where);
    const finalValue = parseMoney("Final Value", record["Final Value"], problems, where);
    let probability: number | null = null;
    const probabilityRaw = text(record["Probability"]);
    if (probabilityRaw !== null) {
      probability = Number(probabilityRaw);
      if (!Number.isInteger(probability) || probability < 0 || probability > 100) {
        problems.push(`${where}: Probability "${probabilityRaw}" must be a whole number from 0 to 100.`);
        probability = null;
      }
    }

    let customFields: unknown = null;
    const customRaw = text(record["Custom Fields (JSON)"]);
    if (customRaw !== null) {
      try {
        customFields = JSON.parse(customRaw);
      } catch {
        problems.push(`${where}: Custom Fields is not valid JSON.`);
      }
    }

    if (!customer || !name || !salesPic || !stage || !status) continue;
    rows.push({
      code,
      customer: cleanName(customer),
      name: name,
      industry: text(record["Industry"]),
      location: text(record["Location"]),
      salesPic: cleanName(salesPic),
      technicalPic: text(record["Technical PIC"]) ? cleanName(record["Technical PIC"]!) : null,
      principal: text(record["Principal"]) ? cleanName(record["Principal"]!) : null,
      solution: text(record["Solution"]) ? cleanName(record["Solution"]!) : null,
      description: text(record["Project Description"]),
      estimatedValue,
      probability,
      targetClosing: parseDate("Target Closing", record["Target Closing"], problems, where),
      stage,
      status,
      competitor: text(record["Competitor"]),
      competitionStatus: text(record["Competition Status"]),
      requirement: text(record["Requirement"]),
      assessmentStatus: text(record["Assessment Status"]),
      solutionProposed: text(record["Solution Proposed"]),
      architectureStatus: text(record["Architecture Status"]),
      sizingStatus: text(record["Sizing Status"]),
      boqStatus: text(record["BOQ Status"] ?? record["BOM Status"]),
      quotationStatus: text(record["Quotation Status"]),
      proposalStatus: text(record["Proposal Status"]),
      pocStatus: text(record["POC Status"]),
      technicalChallenge: text(record["Technical Challenge"]),
      technicalBlocker: text(record["Technical Blocker"]),
      technicalNotes: text(record["Technical Notes"]),
      currentAction: text(record["Current Action"]),
      nextAction: text(record["Next Action"]),
      scopeEstimate: text(record["Scope Estimate"]),
      lostReason: text(record["Lost Reason"]),
      lostNotes: text(record["Lost Notes"]),
      wonDate: parseDate("Won Date", record["Won Date"], problems, where),
      finalValue,
      stakeholders: text(record["PIC / Stakeholder (raw)"]),
      customFields,
    });
  }
  return { rows, problems };
}

export const IMPORT_EMAIL_DOMAIN = "halcominovasi.co.id";

/** `Mas Dzaki` becomes `mas.dzaki@halcominovasi.co.id`: a predictable sign-in name for a development account. */
export function accountEmailFor(personName: string): string {
  const slug = cleanName(personName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug || "user"}@${IMPORT_EMAIL_DOMAIN}`;
}

export type PersonRole = { name: string; role: Role; email: string };

/**
 * People named in the export and the role their development account gets. Anyone named as Technical PIC
 * is a technical (SOA) person, even if the export also lists them as Sales PIC on one project; everyone
 * else is Sales. The export names no Purchasing person, so none is created.
 */
export function peopleFrom(rows: readonly ProjectImportRow[]): PersonRole[] {
  const technical = new Map<string, string>();
  const sales = new Map<string, string>();
  for (const row of rows) {
    if (row.technicalPic && !technical.has(accountEmailFor(row.technicalPic))) technical.set(accountEmailFor(row.technicalPic), row.technicalPic);
    if (!sales.has(accountEmailFor(row.salesPic))) sales.set(accountEmailFor(row.salesPic), row.salesPic);
  }
  const people: PersonRole[] = [];
  for (const [email, name] of technical) people.push({ name, role: "SOA", email });
  for (const [email, name] of sales) if (!technical.has(email)) people.push({ name, role: "SALES", email });
  return people.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}
