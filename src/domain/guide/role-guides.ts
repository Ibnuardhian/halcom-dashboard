import type { Role } from "@/domain/access/roles";

/**
 * What each role reads and what it edits, kept apart on purpose: by default every role reads every project and request
 * (docs/requirements/RBAC.md, assumption A-9), but only the role that owns a field edits it. These sentences describe the default
 * permission matrix; the Permissions page shows the live one.
 */
export type RoleGuide = { summary: string; reads: readonly string[]; edits: readonly string[]; cannot: readonly string[] };

export const ROLE_GUIDES: Record<Role, RoleGuide> = {
  SALES: {
    summary: "Creates projects, manages the pipeline, asks SOA for a BOQ or Purchasing for an RFQ, decides what follows a completed request, and tracks progress.",
    reads: ["Every project and request, with its history", "Customers, Sales Pipeline, Request Center and Sales Targets"],
    edits: [
      "The commercial fields of your own projects (and of projects from another source)",
      "New projects and BOQ, RFQ and PO requests",
      "The decision to continue a completed BOQ or RFQ on your projects",
      "Your own sales targets",
    ],
    cannot: ["Technical fields (SOA)", "Request status and PIC (SOA and Purchasing)", "The commercial fields of another salesperson's project"],
  },
  SOA: {
    summary: "Receives BOQ requests, manages the technical requirement and assessment, prepares and completes the BOQ, and hands it to Purchasing.",
    reads: ["Every project and request, with its history", "BOQ Tickets, Purchasing Handoff and Technical Reports", "Commercial values, read-only"],
    edits: [
      "The technical fields and the classification of a project, with a change log",
      "Current action and Next action updates",
      "BOQ status, PIC and SOA phase",
      "The decision to continue a completed BOQ to an RFQ",
      "Projects registered for a salesperson or from another source, and the project import",
      "Principal and solution master data",
    ],
    cannot: ["Commercial fields (Sales)", "RFQ and PO status (Purchasing)", "The decision to continue a completed RFQ to a PO"],
  },
  PURCHASING: {
    summary: "Receives RFQ requests, raises RFQs for existing projects, keeps the quotation progress current and processes the PO.",
    reads: ["Every project and request, with its history", "The Purchasing Dashboard, RFQ Requests and PO requests"],
    edits: ["RFQ and PO status", "The PIC of an RFQ or PO", "A new RFQ request for an existing project (told to the project's Sales and SOA PICs)"],
    cannot: ["Create projects", "Raise a BOQ or a PO request", "Edit project fields", "Change BOQ status", "Decide what follows a completed RFQ"],
  },
  FINANCE: {
    summary: "Reviews project values and quotation and PO references for crosschecking. Read-only.",
    reads: ["Every project and request, with its history", "The Finance Dashboard and the Financial Crosscheck, with a CSV download"],
    edits: [],
    cannot: ["Change any project or request"],
  },
  MANAGEMENT: {
    summary: "Follows progress on the dashboards and reports. Read-only.",
    reads: ["Every project and request, with its history", "Overview, the Management dashboard, Technical Reports and the Financial Crosscheck"],
    edits: [],
    cannot: ["Change any project or request"],
  },
  ADMIN: {
    summary: "Manages the operational users, the PICs and the master data, and may support Sales, SOA and Purchasing.",
    reads: ["Every dashboard except the Superadmin address, projects, requests, the audit log, the permission matrix and the SLA policies"],
    edits: ["Operational users", "PICs", "Master data", "Projects and requests on behalf of the teams, as the permission matrix allows"],
    cannot: ["Change permissions", "Manage Admin and Superadmin accounts", "Edit SLA policies", "Use System and Backups"],
  },
  SUPERADMIN: {
    summary: "Owns the system: accounts of every role, permissions, SLA policies, system monitoring and backups.",
    reads: ["Everything"],
    edits: ["Accounts of every role", "Permissions", "SLA policies and email templates", "Backups and system tools"],
    cannot: ["Remove their own essential permissions: the editor keeps them"],
  },
};
