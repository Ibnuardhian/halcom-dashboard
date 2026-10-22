import type { Permission } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";

/**
 * The User Guide's one definition of the workflow. The flowchart, its tooltips, the mobile list and the role-by-role steps are all
 * drawn from this file, so a step is written once. Every statement here describes what the application does today (checked against
 * `src/domain/requests`, `src/domain/access/permissions.ts` and the pages named in `links`); add a step only when the feature exists.
 * `tests/unit/guide.test.ts` checks the structure: links point at real pages, permissions exist, no two nodes share a grid cell.
 */

/** The lanes of the flowchart, top to bottom. Every role has one. */
export const GUIDE_LANES = ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT", "ADMIN", "SUPERADMIN"] as const satisfies readonly Role[];

/** Lanes that hold two rows of nodes (Sales has two parallel ways to start a request). */
export const LANE_ROWS: Record<(typeof GUIDE_LANES)[number], number> = {
  SALES: 2,
  SOA: 1,
  PURCHASING: 1,
  FINANCE: 1,
  MANAGEMENT: 1,
  ADMIN: 1,
  SUPERADMIN: 1,
};

/**
 * What a role has to hold to count as taking part in the workflow as that role. The guide highlights a role when the signed-in
 * account's permissions include all of these, so an Admin (who may support Sales, SOA and Purchasing) lights up each of them, and a
 * change in the permission editor changes the highlighting. It never looks at a name or an address.
 */
export const GUIDE_ROLE_CAPABILITY: Record<Role, readonly Permission[]> = {
  SALES: ["projects.create", "requests.create", "projects.edit.commercial"],
  SOA: ["requests.work.boq", "requests.handover", "projects.edit.technical"],
  PURCHASING: ["requests.work.purchasing"],
  FINANCE: ["dashboard.finance.view", "finance.crosscheck.view"],
  MANAGEMENT: ["dashboard.management.view"],
  ADMIN: ["users.manage", "pics.manage"],
  SUPERADMIN: ["permissions.manage"],
};

/**
 * Roles whose detailed steps are shown only to someone who holds that role's capability. Everyone sees that these lanes exist and
 * what they are for; the step-by-step instructions are for the people who can act on them.
 */
export const RESTRICTED_GUIDE_ROLES: readonly Role[] = ["ADMIN", "SUPERADMIN"];

export type NodeKind = "action" | "handoff" | "decision" | "readonly" | "setup";

/** Shown as text and an icon next to every node, so a node's kind never depends on colour. */
export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  action: "Action",
  handoff: "Handoff",
  decision: "Decision",
  readonly: "Read-only",
  setup: "Setup",
};

/** A page a step points at, shown only to someone who holds at least one of the permissions that open it. */
export type GuideLink = { label: string; href: string; anyOf: readonly Permission[] };

export type GuideNode = {
  id: string;
  role: Role;
  kind: NodeKind;
  /** The action, as a short title. */
  title: string;
  /** Who receives the result, in a few words (the chart shows it as "Next"). */
  next: string;
  /** Position: a column along the flow and, in a two-row lane, the row. */
  col: number;
  row?: 0 | 1;
  /** Tooltip content. */
  action: string;
  input: string;
  output: string;
  recipient: string;
  /** Role-by-role instructions. */
  guide: {
    where: string;
    prerequisites: readonly string[];
    steps: readonly string[];
    editable: readonly string[];
    handoff: string;
    links: readonly GuideLink[];
  };
};

/** `work`: the same role carries on. `handoff`: the work passes to another role. `support`: information or setup, nothing is handed over. */
export type EdgeStyle = "work" | "handoff" | "support";
/** `h`: straight; `curve`: S-curve between neighbouring columns; `hv`: across then up or down; `vh`: up or down then across; `v`: straight up or down. */
export type EdgeRoute = "h" | "curve" | "hv" | "vh" | "v";
export type GuideEdge = { from: string; to: string; style: EdgeStyle; route: EdgeRoute; label?: string };

const PROJECTS_NEW = { label: "New project", href: "/projects/new", anyOf: ["projects.create", "projects.assign-sales", "projects.create.external"] } as const satisfies GuideLink;
const PROJECTS = { label: "Projects", href: "/projects", anyOf: ["projects.view"] } as const satisfies GuideLink;

export const GUIDE_NODES: readonly GuideNode[] = [
  // ---- Sales ---------------------------------------------------------------------------------------------------------------
  {
    id: "sales.create",
    role: "SALES",
    kind: "action",
    title: "Create the project",
    next: "Submit a request",
    col: 0,
    row: 0,
    action: "Register the opportunity as a project. You become its Sales PIC. The Project ID (HIT-PROJ-001, HIT-PROJ-002 and so on) is assigned when you save.",
    input: "End-user company and project name (required). Optional: target closing, progress, status, estimated PO value, description.",
    output: "A project with its Project ID. Every role can read it.",
    recipient: "You: raise a BOQ or RFQ request next, or choose one in the same form.",
    guide: {
      where: "Projects → New project",
      prerequisites: ["You are signed in with a Sales account (an Admin or Superadmin can do this on behalf of Sales)."],
      steps: [
        "Open Projects and choose New project.",
        "Enter the end-user company and the project name. Add the target closing date, estimated PO value and description if you know them.",
        "To ask for work straight away, pick BOQ or RFQ under the request choices and fill in its summary. Leave it empty to create only the project.",
        "Choose Create project (or Create project and BOQ request). The Project ID appears on the project page.",
      ],
      editable: ["End-user company", "Project name", "Target closing", "Progress", "Status", "Estimated PO value", "Description"],
      handoff: "A project alone hands nothing over. A request created in the same form goes to the team that owns it (SOA for a BOQ, Purchasing for an RFQ).",
      links: [PROJECTS_NEW, PROJECTS],
    },
  },
  {
    id: "sales.boq",
    role: "SALES",
    kind: "handoff",
    title: "Submit a BOQ request",
    next: "SOA",
    col: 1,
    row: 0,
    action: "Ask SOA for a Bill of Quantities for the project.",
    input: "The project, a one-line summary (required), details, and an optional needed-by date.",
    output: "A BOQ request in status Submitted, an in-app notification to the SOA team, and email text (To, Cc, subject, body) to copy into Outlook. The application does not send email itself.",
    recipient: "SOA",
    guide: {
      where: "Projects → open the project → Requests → New BOQ",
      prerequisites: ["The project exists and its status is On Track."],
      steps: [
        "Open the project and go to its Requests section.",
        "Choose New BOQ. Enter the summary and details; add a needed-by date if there is one.",
        "Choose Create request.",
        "Open the email text on the request, copy it into Outlook and send it to the SOA group yourself.",
      ],
      editable: ["Summary", "Details", "Needed by"],
      handoff: "SOA is notified in the application. The email is yours to send: the application only prepares the text.",
      links: [PROJECTS, { label: "New request", href: "/requests/new", anyOf: ["requests.create"] }],
    },
  },
  {
    id: "sales.revise",
    role: "SALES",
    kind: "handoff",
    title: "Request a revision",
    next: "SOA (Revision stage)",
    col: 4,
    row: 0,
    action: "When the customer wants changes to a completed BOQ, send it back from the request page. The ticket goes straight to the Revision stage and SOA gets a red notification.",
    input: "A completed BOQ, and the change the customer asked for (required, up to 500 characters).",
    output:
      "The BOQ in status Revision with your reason in its history. SOA (the team and the project's technical PIC) is notified, and the notification and the bell are red. A BOQ only: an RFQ or a PO is reopened by Purchasing.",
    recipient: "SOA",
    guide: {
      where: "Open the completed BOQ → Request a revision",
      prerequisites: ["The BOQ is Completed.", "You own the project (any salesperson may on a project from another source), or you are an Admin."],
      steps: [
        "Open the completed BOQ from the project's Requests section or from the Request Center.",
        "In Request a revision, describe what the customer wants changed.",
        "Choose Request revision. The BOQ moves to Revision and SOA is told.",
        "SOA reworks it and completes it again; its first completion date is kept, so the revision does not make the SLA late.",
      ],
      editable: ["What needs to change"],
      handoff: "SOA sees the BOQ in the Revision column of the BOQ board and gets a red notification.",
      links: [{ label: "Request Center", href: "/requests", anyOf: ["requests.view"] }, PROJECTS],
    },
  },
  {
    id: "sales.rfq",
    role: "SALES",
    kind: "handoff",
    title: "Submit an RFQ (skip the BOQ)",
    next: "Purchasing",
    col: 5,
    row: 1,
    action: "Ask Purchasing for a quotation or pricing directly. A BOQ can be skipped: the flow may start with an RFQ.",
    input: "The project, a one-line summary (required), details, and an optional needed-by date.",
    output: "An RFQ request in status Submitted, an in-app notification to the Purchasing team, and email text to copy into Outlook.",
    recipient: "Purchasing",
    guide: {
      where: "Projects → open the project → Requests → New RFQ",
      prerequisites: ["The project exists and its status is On Track."],
      steps: [
        "Open the project and go to its Requests section.",
        "Choose New RFQ. Enter the summary and the known specifications, quantities, brands and constraints.",
        "Choose Create request.",
        "Copy the email text into Outlook and send it to the Purchasing group yourself.",
      ],
      editable: ["Summary", "Details", "Needed by"],
      handoff: "Purchasing is notified in the application. SOA does not get the email text of an RFQ that Sales raised.",
      links: [PROJECTS, { label: "New request", href: "/requests/new", anyOf: ["requests.create"] }],
    },
  },
  {
    id: "sales.po",
    role: "SALES",
    kind: "decision",
    title: "Decide on the PO",
    next: "Purchasing",
    col: 8,
    row: 1,
    action: "On a completed RFQ, choose Continue to PO or Do not continue. A PO can only be raised once the project has a completed RFQ.",
    input: "A completed RFQ that has no decision yet, and an optional note of up to 500 characters.",
    output: "A PO request in status Submitted for Purchasing that points back to the RFQ, or a recorded decision not to continue (the note says why).",
    recipient: "Purchasing (Sales and the Purchasing team are notified)",
    guide: {
      where: "Open the completed RFQ → What happens next?",
      prerequisites: ["The RFQ is Completed and has no earlier decision.", "You own the project (any salesperson may decide on a project whose source is Other), or you are an Admin."],
      steps: [
        "Open the completed RFQ from the project's Requests section or from RFQ requests.",
        "In What happens next?, add a note if you want one.",
        "Choose Continue to PO, or Do not continue and say why in the note.",
      ],
      editable: ["Note"],
      handoff: "Continuing creates the PO request for Purchasing. Completing an RFQ never authorises a purchase by itself.",
      links: [PROJECTS],
    },
  },
  {
    id: "sales.track",
    role: "SALES",
    kind: "action",
    title: "Update commercial details",
    next: "Everyone (shared view)",
    col: 9,
    row: 0,
    action: "Keep the commercial side of the project current and follow it on the Sales Pipeline and Sales Targets pages.",
    input: "Progress, status, estimated value, target margin, quote release, target closing, final value and won date as the deal moves.",
    output: "Up-to-date pipeline figures and a change log of every edit. Every role reads the project; Finance reads its values and references.",
    recipient: "Everyone who can read the project",
    guide: {
      where: "Project → Commercial; Sales Pipeline; Sales Targets",
      prerequisites: ["You are the Sales PIC of the project (or it is a project from another source) or an Admin."],
      steps: [
        "Open the project and go to Commercial.",
        "Update progress, status, values, margin and dates, then save. Each change is written to the change log.",
        "Follow the Sales Pipeline dashboard for your pipeline and the Sales Targets page for your targets.",
        "Check the Requests section to see where the BOQ, RFQ and PO stand.",
      ],
      editable: ["Progress", "Status", "Estimated PO value", "Target margin", "Quote released", "Target closing", "Final value", "Won date"],
      handoff: "Nothing is handed over. Project details stay readable by every role; only the Sales PIC edits the commercial fields.",
      links: [
        { label: "Sales Pipeline", href: "/dashboard/sales", anyOf: ["dashboard.sales.view"] },
        { label: "Sales Targets", href: "/targets", anyOf: ["dashboard.sales.view"] },
        PROJECTS,
      ],
    },
  },

  // ---- SOA -----------------------------------------------------------------------------------------------------------------
  {
    id: "soa.register",
    role: "SOA",
    kind: "action",
    title: "Register a project",
    next: "BOQ Tickets",
    col: 0,
    action:
      "Register a project for a salesperson you pick (source Internal Sales), or for an external sales company or other source (source Other, no internal Sales PIC), and raise its BOQ in the same form.",
    input: "End-user company and project name. For Internal Sales, the salesperson (required). For Other, the external sales name (required).",
    output: "A project and, if chosen, its first BOQ request.",
    recipient: "SOA's own BOQ Tickets",
    guide: {
      where: "Projects → New project",
      prerequisites: ["You are signed in with a SOA account (an Admin or Superadmin can do this too)."],
      steps: [
        "Open Projects and choose New project.",
        "Choose the project source: Internal Sales (then pick the salesperson) or Other (then enter the sales name).",
        "Enter the end-user company and project name.",
        "Choose BOQ under the request choices, enter its summary, and create the project and request.",
      ],
      editable: ["Project source", "Sales PIC or external sales name", "End-user company", "Project name", "Request summary and details"],
      handoff: "The BOQ lands in BOQ Tickets, ready to be triaged.",
      links: [PROJECTS_NEW, PROJECTS],
    },
  },
  {
    id: "soa.receive",
    role: "SOA",
    kind: "action",
    title: "Receive and triage the BOQ",
    next: "SOA PIC",
    col: 2,
    action: "A new BOQ appears in BOQ Tickets and SOA is notified. Assign a PIC (a named SOA person, not a login) and start the work.",
    input: "The BOQ request (summary, details, needed-by date) and the email from Sales.",
    output: "A BOQ with a PIC, moved from Submitted to In progress.",
    recipient: "The SOA PIC who works the BOQ",
    guide: {
      where: "BOQ Tickets → open the request",
      prerequisites: ["A BOQ in status Submitted.", "At least one active SOA PIC exists (an Admin keeps the list under PICs)."],
      steps: [
        "Open BOQ Tickets and open the new request.",
        "In the PIC card, choose the PIC and choose Save PIC. The change is kept in the PIC history.",
        "Open the BOQ board and drag the card from Submitted to In progress.",
      ],
      editable: ["PIC", "Request status"],
      handoff: "The requester and the project's Sales PIC are notified of every status change.",
      links: [{ label: "BOQ Tickets", href: "/requests/boq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "soa.work",
    role: "SOA",
    kind: "action",
    title: "Work the technical requirement",
    next: "Sales (by email)",
    col: 3,
    action: "Record the technical details on the project, label the part of the work you are on (Assessment, Sizing or POC) and post updates.",
    input: "The customer's requirement and your assessment findings.",
    output:
      "Updated technical fields (every change logged from and to), a phase label that Sales and Purchasing are notified about, and Current action and Next action entries in the project's Activity feed.",
    recipient: "Sales, by email for questions; everyone, through the project page",
    guide: {
      where: "Project → Technical and Activity; request page → SOA phase",
      prerequisites: ["The BOQ is open (Submitted, In progress or Revision)."],
      steps: [
        "Open the project. Under Technical, set the classification (principals and solution) and fill in the technical details, then choose Save technical details.",
        "Open the BOQ request and choose the phase (Assessment, Sizing or POC) in the SOA phase card.",
        "Under Activity, post what was done (Current action) and what follows (Next action).",
        "Ask Sales your questions and agree revisions by email, which keeps the history. The status Waiting for Sales is retired.",
      ],
      editable: [
        "Requirement",
        "Assessment, architecture, sizing, BOQ, quotation, proposal and POC status",
        "Solution proposed",
        "Scope estimate",
        "Technical challenge, blocker and notes",
        "Principals and solution",
        "SOA phase",
      ],
      handoff: "Technical fields are SOA's to edit. Sales' commercial fields stay read-only for SOA.",
      links: [PROJECTS, { label: "BOQ Tickets", href: "/requests/boq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "soa.complete",
    role: "SOA",
    kind: "action",
    title: "Prepare and complete the BOQ",
    next: "Purchasing Handoff",
    col: 4,
    action:
      "Prepare the BOQ, then move its card to Completed on the BOQ board. The BOQ document itself is prepared outside the application; the application tracks the request, its status and its history.",
    input: "The finished BOQ. Cancelling asks for a reason.",
    output: "A Completed BOQ. The requester and the project's Sales PIC are notified, and it is listed under Ready for handoff.",
    recipient: "Purchasing Handoff list (ready for a decision)",
    guide: {
      where: "BOQ Tickets → board view",
      prerequisites: ["The BOQ is Submitted, In progress or Revision."],
      steps: [
        "Open the BOQ board.",
        "Drag the card to Completed. A Submitted card may go straight to Completed.",
        "If the customer later asks for changes (agreed by email), drag the completed card to Revision, rework it and complete it again.",
        "To stop the request, drag it to Cancelled and give the reason.",
      ],
      editable: ["Request status (with a reason for Cancelled)"],
      handoff: "A completed BOQ does not authorise anything by itself: someone has to decide whether it continues.",
      links: [{ label: "BOQ Tickets", href: "/requests/boq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "soa.handoff",
    role: "SOA",
    kind: "handoff",
    title: "Hand off to Purchasing",
    next: "Purchasing",
    col: 5,
    action:
      "On a completed BOQ choose Continue to RFQ, which creates an RFQ request for Purchasing that points back to the BOQ, or Do not continue with a note. The Sales owner of the project and Admins can make this decision too.",
    input: "A completed BOQ with no decision yet, and an optional note of up to 500 characters.",
    output: "An RFQ request in status Submitted. Purchasing, the requester and the Sales PIC are notified, and it is listed under Recently handed over. Or a recorded decision not to continue.",
    recipient: "Purchasing",
    guide: {
      where: "Purchasing Handoff → Ready for handoff → open the BOQ → What happens next?",
      prerequisites: ["The BOQ is Completed and has no earlier decision."],
      steps: [
        "Open Purchasing Handoff. Completed BOQs that await a decision are listed, oldest first.",
        "Open one and read What happens next?.",
        "Add a note if useful, then choose Continue to RFQ (or Do not continue and say why).",
        "Use the email text on the new RFQ and reply in the original BOQ email thread so the conversation stays together.",
      ],
      editable: ["Decision note"],
      handoff: "The RFQ keeps the project and points back to the BOQ. Purchasing sees it in RFQ Requests.",
      links: [{ label: "Purchasing Handoff", href: "/handoffs", anyOf: ["handoffs.view"] }],
    },
  },

  // ---- Purchasing ----------------------------------------------------------------------------------------------------------
  {
    id: "pur.raise",
    role: "PURCHASING",
    kind: "handoff",
    title: "Raise an RFQ for a project",
    next: "Purchasing, told to Sales and SOA",
    col: 5,
    action:
      "Raise an RFQ yourself for a project that already exists. Narrow the projects by Sales PIC or SOA PIC; the project's own PICs are shown. The RFQ comes to Purchasing and is also told to the project's Sales PIC and SOA PIC.",
    input: "The project, a one-line summary (required), details, and an optional needed-by date. Optionally a Sales PIC and an SOA PIC to narrow the project list.",
    output:
      "An RFQ request in status Submitted. The Purchasing team, the project's Sales PIC and its SOA PIC are notified, and it shows on the Sales dashboard of the Sales PIC. Only an RFQ can be raised this way, never a BOQ or a PO.",
    recipient: "Purchasing; the project's Sales PIC and SOA PIC are told",
    guide: {
      where: "RFQ Requests → New RFQ request",
      prerequisites: ["The project exists (Sales or SOA register projects) and its status is On Track."],
      steps: [
        "Open RFQ Requests and choose New RFQ request.",
        "Optionally choose a Sales PIC and an SOA PIC to narrow the list, then choose the project. Its Sales PIC and SOA PIC appear beside it.",
        "Enter the summary and the known specifications, quantities, brands and constraints, then choose Create request.",
        "The RFQ appears in your RFQ list; the Sales PIC sees it in the Request Center and on their dashboard.",
      ],
      editable: ["Project", "Summary", "Details", "Needed by"],
      handoff: "The Sales PIC and the SOA PIC are notified in the application. Purchasing does not send the request email: the Sales PIC can copy it from the request.",
      links: [{ label: "RFQ Requests", href: "/requests/rfq", anyOf: ["requests.view"] }, { label: "New request", href: "/requests/new", anyOf: ["requests.create.rfq", "requests.create"] }],
    },
  },
  {
    id: "pur.receive",
    role: "PURCHASING",
    kind: "action",
    title: "Receive the RFQ",
    next: "Purchasing PIC",
    col: 6,
    action: "An RFQ arrives from Sales, or from SOA after a BOQ. It appears in RFQ Requests and Purchasing is notified. Assign a PIC.",
    input: "The RFQ request: summary, details, needed-by date, and a link back to the BOQ when it was handed over.",
    output: "An RFQ with a Purchasing PIC.",
    recipient: "The Purchasing PIC who works the RFQ",
    guide: {
      where: "RFQ Requests → open the request",
      prerequisites: ["An RFQ in status Submitted.", "At least one active Purchasing PIC exists (an Admin keeps the list under PICs)."],
      steps: [
        "Open RFQ Requests and open the new request.",
        "In the PIC card, choose the PIC and choose Save PIC.",
        "Open the RFQ board and drag the card from Submitted to In progress.",
      ],
      editable: ["PIC", "Request status"],
      handoff: "The requester and the project's Sales PIC are notified of every status change.",
      links: [{ label: "RFQ Requests", href: "/requests/rfq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "pur.quote",
    role: "PURCHASING",
    kind: "action",
    title: "Update quotation progress",
    next: "Sales",
    col: 7,
    action:
      "Keep the RFQ's status and PIC current until the quotation is complete. The quotation work itself happens outside the application; the application tracks the request.",
    input: "The state of the quotation work. Cancelling an RFQ, or reopening a completed one, asks for a reason.",
    output: "A Completed RFQ. The requester and the project's Sales PIC are notified, and the RFQ becomes the project's quotation reference for Finance.",
    recipient: "Sales, who decide whether it continues to a PO",
    guide: {
      where: "RFQ Requests → board view",
      prerequisites: ["The RFQ is Submitted or In progress."],
      steps: [
        "Open the RFQ board.",
        "Drag the card to In progress while you work, and to Completed when the quotation is done.",
        "Change the PIC on the request page if the work moves to someone else.",
        "To stop the request drag it to Cancelled and give the reason. A completed RFQ can be reopened to In progress, also with a reason.",
      ],
      editable: ["Request status (with a reason for Cancelled and for reopening)", "PIC"],
      handoff: "Sales decides whether a completed RFQ continues to a PO. Purchasing does not raise the PO itself.",
      links: [{ label: "RFQ Requests", href: "/requests/rfq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "pur.po",
    role: "PURCHASING",
    kind: "action",
    title: "Process the PO",
    next: "Sales and Finance",
    col: 9,
    action: "Work the PO request that Sales raised from a completed RFQ, and complete it.",
    input: "The PO request, which points back to the completed RFQ.",
    output: "A Completed PO. The requester and the project's Sales PIC are notified, and the PO becomes the project's PO reference for Finance.",
    recipient: "Sales (notified) and Finance (reads the reference)",
    guide: {
      where: "PO requests → board view",
      prerequisites: ["A PO request in status Submitted. It exists only after a completed RFQ."],
      steps: [
        "Open PO requests and open the new request.",
        "Assign a PIC in the PIC card and choose Save PIC.",
        "On the PO board drag the card to In progress, then to Completed. A completed PO can be reopened to In progress with a reason.",
      ],
      editable: ["PIC", "Request status (with a reason for Cancelled and for reopening)"],
      handoff: "A PO is the last step of the flow. Sales and Finance read the result.",
      links: [{ label: "PO requests", href: "/requests/po", anyOf: ["requests.view"] }],
    },
  },

  // ---- Finance -------------------------------------------------------------------------------------------------------------
  {
    id: "fin.check",
    role: "FINANCE",
    kind: "readonly",
    title: "Crosscheck values and references",
    next: "No handoff (read-only)",
    col: 9,
    action:
      "Compare each project's value with its quotation (RFQ) and PO references and with its progress. Flags: Closed Won without a final value, a PO reference or a quotation reference, and a completed PO on a project that is not Closed Won.",
    input: "Nothing to enter. Optionally filter by flag, search, and download the list as CSV.",
    output: "A read-only list of projects with their flags. Nothing on the page changes a project or a request.",
    recipient: "No one: Finance reads and reports through its own channels",
    guide: {
      where: "Financial Crosscheck",
      prerequisites: ["Projects with RFQ and PO requests exist."],
      steps: [
        "Open Financial Crosscheck.",
        "Pick a flag to see only the projects that need a look, or search for a project.",
        "Open a project to read its values, its Requests and the history behind a reference.",
        "Download the CSV if you need the list elsewhere.",
      ],
      editable: ["Nothing: this role is read-only"],
      handoff: "Finance cannot change projects or requests. A difference is for Sales (commercial fields) or Purchasing (requests) to correct.",
      links: [
        { label: "Financial Crosscheck", href: "/finance/crosscheck", anyOf: ["finance.crosscheck.view"] },
        { label: "Finance Dashboard", href: "/dashboard/finance", anyOf: ["dashboard.finance.view"] },
        PROJECTS,
      ],
    },
  },

  // ---- Management ----------------------------------------------------------------------------------------------------------
  {
    id: "mgmt.follow",
    role: "MANAGEMENT",
    kind: "readonly",
    title: "Follow progress",
    next: "No handoff (read-only)",
    col: 9,
    action: "Read the dashboards and reports. This role changes nothing.",
    input: "Nothing to enter.",
    output: "The Overview, the Management dashboard, the Technical Reports and the Financial Crosscheck.",
    recipient: "No one",
    guide: {
      where: "Overview, Management dashboard, Technical Reports, Financial Crosscheck",
      prerequisites: ["None."],
      steps: [
        "Open Overview for the pipeline and request counts.",
        "Open Technical Reports for the monthly BOQ report.",
        "Open Financial Crosscheck to read values and references.",
        "Open any project or request to read its details and history.",
      ],
      editable: ["Nothing: this role is read-only"],
      handoff: "None.",
      links: [
        { label: "Overview", href: "/dashboard", anyOf: ["dashboard.shared.view"] },
        { label: "Management dashboard", href: "/dashboard/management", anyOf: ["dashboard.management.view"] },
        { label: "Technical Reports", href: "/reports/technical", anyOf: ["reports.technical.view"] },
        { label: "Financial Crosscheck", href: "/finance/crosscheck", anyOf: ["finance.crosscheck.view"] },
      ],
    },
  },

  // ---- Administration ------------------------------------------------------------------------------------------------------
  {
    id: "admin.setup",
    role: "ADMIN",
    kind: "setup",
    title: "Keep users, PICs and master data",
    next: "SOA and Purchasing",
    col: 2,
    action: "Create and manage the operational accounts, keep the lists of SOA and Purchasing PICs, and keep the master data (principals and solutions) the project forms pick from.",
    input: "Names, roles and status of operational users and PICs; master data records.",
    output: "Accounts that can sign in, and the PICs that tickets are handed to. An Admin can also read the audit log, the permission matrix and the SLA policies.",
    recipient: "SOA and Purchasing, who pick PICs from these lists",
    guide: {
      where: "Users and Roles, PICs, Master Data, Audit Logs",
      prerequisites: ["You hold an Admin or Superadmin account."],
      steps: [
        "Open Users and Roles to create an operational user, change a role, deactivate an account or reset a password.",
        "Open PICs to add or deactivate the people SOA and Purchasing tickets are handed to. PICs are not login accounts.",
        "Open Master Data to maintain principals and solutions.",
        "Open Audit Logs to see who changed what.",
      ],
      editable: ["Operational users", "PICs", "Master data"],
      handoff: "An Admin can manage only the operational roles. Admin and Superadmin accounts belong to the Superadmin.",
      links: [
        { label: "Users and Roles", href: "/admin/users", anyOf: ["users.view"] },
        { label: "PICs", href: "/admin/pics", anyOf: ["pics.manage"] },
        { label: "Master Data", href: "/admin/master-data", anyOf: ["masterdata.manage"] },
        { label: "Audit Logs", href: "/admin/audit", anyOf: ["audit.view"] },
      ],
    },
  },
  {
    id: "super.config",
    role: "SUPERADMIN",
    kind: "setup",
    title: "Permissions and system settings",
    next: "Admin and every role",
    col: 2,
    action: "Decide what each role may do, set the SLA range and email templates per team, and look after the system.",
    input: "Permission grants per role, SLA policies, and the system tools.",
    output: "The rules every signed-in request starts from, recorded in the audit log.",
    recipient: "Admin and every role (the changes apply to their next request)",
    guide: {
      where: "Permissions, SLA Policies, System, Backups",
      prerequisites: ["You hold the Superadmin account."],
      steps: [
        "Open Permissions to grant or revoke permissions for a role. Each save is one audit event per changed role.",
        "Open SLA Policies to edit the SLA range and the email template of SOA and Purchasing.",
        "Open System to watch application and database health, and Backups to create a database dump.",
        "Manage Admin and Superadmin accounts under Users and Roles.",
      ],
      editable: ["Role permissions", "SLA policies and email templates", "Admin and Superadmin accounts"],
      handoff: "A Superadmin always keeps the permissions that manage accounts and permissions.",
      links: [
        { label: "Permissions", href: "/admin/permissions", anyOf: ["permissions.view"] },
        { label: "SLA Policies", href: "/admin/settings", anyOf: ["settings.view"] },
        { label: "System", href: "/admin/system", anyOf: ["system.monitor"] },
        { label: "Backups", href: "/admin/backups", anyOf: ["system.backup"] },
      ],
    },
  },
];

export const GUIDE_EDGES: readonly GuideEdge[] = [
  { from: "sales.create", to: "sales.boq", style: "work", route: "h" },
  { from: "sales.create", to: "sales.rfq", style: "work", route: "vh", label: "Skip the BOQ" },
  { from: "soa.register", to: "soa.receive", style: "work", route: "h" },
  { from: "sales.boq", to: "soa.receive", style: "handoff", route: "curve" },
  { from: "sales.revise", to: "soa.complete", style: "handoff", route: "v", label: "Revision" },
  { from: "soa.receive", to: "soa.work", style: "work", route: "h" },
  { from: "soa.work", to: "soa.complete", style: "work", route: "h" },
  { from: "soa.complete", to: "soa.handoff", style: "work", route: "h" },
  { from: "soa.handoff", to: "pur.receive", style: "handoff", route: "curve" },
  { from: "sales.rfq", to: "pur.receive", style: "handoff", route: "hv" },
  { from: "pur.raise", to: "pur.receive", style: "work", route: "h" },
  { from: "pur.receive", to: "pur.quote", style: "work", route: "h" },
  { from: "pur.quote", to: "sales.po", style: "handoff", route: "hv" },
  { from: "sales.po", to: "pur.po", style: "handoff", route: "curve" },
  { from: "pur.po", to: "sales.track", style: "handoff", route: "v" },
  { from: "pur.po", to: "fin.check", style: "support", route: "v", label: "References, read-only" },
  { from: "admin.setup", to: "soa.receive", style: "support", route: "v", label: "PICs" },
  { from: "admin.setup", to: "pur.receive", style: "support", route: "hv" },
  { from: "super.config", to: "admin.setup", style: "support", route: "v", label: "Permissions, SLA" },
];

export const GUIDE_NODES_BY_ID: ReadonlyMap<string, GuideNode> = new Map(GUIDE_NODES.map((node) => [node.id, node]));
