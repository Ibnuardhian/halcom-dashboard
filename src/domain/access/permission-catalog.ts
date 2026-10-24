import { DASHBOARD_KEYS, type DashboardKey } from "./dashboards";
import { ALL_PERMISSIONS, type Permission } from "./permissions";
import { ROLE_LABELS, ROLES } from "./roles";

/**
 * How the permission editor groups and explains every permission. The identifiers stay exactly as the code checks them; only the
 * label, the description and the category are added here. The `Record<Permission, …>` types make the compiler refuse a permission
 * that is missing, and a unit test proves each one is listed in exactly one category.
 */
export const PERMISSION_CATEGORIES = [
  { id: "dashboard-access", title: "Dashboard Access", description: "Which dashboards a role may open. Each dashboard is granted on its own." },
  { id: "user-role-management", title: "User & Role Management", description: "Seeing and managing accounts and their roles." },
  { id: "permission-management", title: "Permission Management", description: "Seeing and changing what each role may do." },
  { id: "project-management", title: "Project Management", description: "Registering, editing, importing, reassigning and deleting projects." },
  { id: "request-workflow", title: "Request, BOQ, RFQ & Handoffs", description: "Raising and working BOQ, RFQ and PO requests, and handing BOQs to Purchasing." },
  { id: "master-data", title: "Master Data, Principals, Customers & PICs", description: "The lists projects and requests draw from, and the people tickets are assigned to." },
  { id: "sales-pipeline", title: "Sales Pipeline & Targets", description: "A salesperson's own targets." },
  { id: "finance", title: "Finance & Crosscheck", description: "Reading project values against quotation and PO references." },
  { id: "reports", title: "Reports & Analytics", description: "Operational reports and their exports." },
  { id: "audit-system", title: "Audit, System & Configuration", description: "The audit trail, system health, backups, SLA policy and the theme." },
] as const;

export type PermissionCategoryId = (typeof PERMISSION_CATEGORIES)[number]["id"];

type Entry = { category: PermissionCategoryId; label: string; description: string };

const DASHBOARD_LABELS: Record<DashboardKey, string> = {
  superadmin: ROLE_LABELS.SUPERADMIN,
  admin: ROLE_LABELS.ADMIN,
  sales: ROLE_LABELS.SALES,
  soa: ROLE_LABELS.SOA,
  purchasing: ROLE_LABELS.PURCHASING,
  finance: ROLE_LABELS.FINANCE,
  management: ROLE_LABELS.MANAGEMENT,
};

const DASHBOARD_ENTRIES = Object.fromEntries(
  DASHBOARD_KEYS.map((key) => [
    `dashboard.${key}.view`,
    { category: "dashboard-access", label: `${DASHBOARD_LABELS[key]} dashboard`, description: `Open the ${DASHBOARD_LABELS[key]} dashboard at /dashboard/${key}.` } satisfies Entry,
  ]),
) as Record<`dashboard.${DashboardKey}.view`, Entry>;

export const PERMISSION_CATALOG: Record<Permission, Entry> = {
  "dashboard.shared.view": { category: "dashboard-access", label: "Overview", description: "Open the shared Overview at /dashboard: project progress and request statistics." },
  ...DASHBOARD_ENTRIES,

  "users.view": { category: "user-role-management", label: "View users", description: "See the list of accounts and the account counts on the Admin dashboard." },
  "users.manage": { category: "user-role-management", label: "Manage users", description: "Create accounts, change roles, deactivate and reset passwords of operational users." },
  "users.manage-privileged": { category: "user-role-management", label: "Manage admin accounts", description: "Create and change Admin and Superadmin accounts. Only a superadmin can hold this." },

  "permissions.view": { category: "permission-management", label: "View permissions", description: "Open the Permissions page and see what each role may do." },
  "permissions.manage": { category: "permission-management", label: "Manage permissions", description: "Grant and revoke permissions of roles. Only a superadmin can hold this." },

  "projects.view": { category: "project-management", label: "View projects", description: "See the project list, project pages, Overview charts and the project export." },
  "projects.create": { category: "project-management", label: "Register own projects", description: "Register a project as its Sales owner (source Internal Sales)." },
  "projects.create.external": { category: "project-management", label: "Register external projects", description: "Register a project from outside the internal Sales team (source Other)." },
  "projects.assign-sales": { category: "project-management", label: "Register for a salesperson", description: "Pick the internal salesperson a project is registered for." },
  "projects.import": { category: "project-management", label: "Import projects", description: "Import projects from an Excel sheet and download the template." },
  "projects.edit.source": { category: "project-management", label: "Edit project source", description: "Change whether a project is Internal Sales or Other, and the external sales details." },
  "projects.edit.technical": { category: "project-management", label: "Edit technical fields", description: "Change the technical fields of a project, with a change log." },
  "projects.edit.commercial": { category: "project-management", label: "Edit commercial fields", description: "Change value, margin, probability and other commercial fields of a project." },
  "projects.delete": { category: "project-management", label: "Delete projects", description: "Delete a project (it is hidden, its history stays)." },
  "projects.reassign": { category: "project-management", label: "Reassign project PICs", description: "Move a project to another Sales, Technical (SOA) or Purchasing PIC." },
  "projects.post-update": { category: "project-management", label: "Post project updates", description: "Add Current action and Next action updates to a project." },

  "requests.view": { category: "request-workflow", label: "View requests", description: "See the request lists, request pages and their history." },
  "requests.create": { category: "request-workflow", label: "Raise requests", description: "Raise a BOQ, RFQ or PO request for a project." },
  "requests.create.external": { category: "request-workflow", label: "Raise requests for external projects", description: "Raise a request on a project whose source is Other." },
  "requests.create.rfq": { category: "request-workflow", label: "Raise RFQ requests", description: "Raise an RFQ request (only an RFQ) for an existing project, for example Purchasing on behalf of the project's Sales and SOA PICs." },
  "requests.edit-dates": { category: "request-workflow", label: "Correct request dates", description: "Set the date a request was created and the date it was completed by hand, for tickets entered late or recorded wrongly. Only a superadmin can hold this; every change is audited." },
  "requests.revise": { category: "request-workflow", label: "Request a revision", description: "Send a completed BOQ back to SOA for changes the customer asked for: the request goes straight to the Revision stage and SOA is told (Sales on their own projects)." },
  "requests.email": { category: "request-workflow", label: "Request email text", description: "Copy the email text of a request to send to the team." },
  "requests.work.boq": { category: "request-workflow", label: "Work BOQ requests", description: "Change the status of BOQ requests and hand them to a PIC (SOA)." },
  "requests.work.purchasing": { category: "request-workflow", label: "Work RFQ & PO requests", description: "Change the status of RFQ and PO requests and hand them to a PIC (Purchasing)." },
  "requests.handover": { category: "request-workflow", label: "Continue the request flow", description: "Decide the step after a completed BOQ or RFQ (hand a BOQ to Purchasing as an RFQ, continue an RFQ to a PO) on any project, not only one's own." },
  "handoffs.view": { category: "request-workflow", label: "View Purchasing handoffs", description: "Open the Purchasing Handoff page." },

  "masterdata.manage": { category: "master-data", label: "Manage master data", description: "Maintain principals, solution categories and customers, and classify projects with them." },
  "pics.manage": { category: "master-data", label: "Manage PICs", description: "Add, rename and deactivate the PICs SOA and Purchasing tickets are assigned to." },
  "customers.view": { category: "master-data", label: "View customers", description: "Open the Customers page." },
  "customers.edit": { category: "master-data", label: "Edit customer details", description: "Fill in a customer's industry on the Customers page; charts, filters and exports use it for all of the customer's projects." },

  "targets.edit": { category: "sales-pipeline", label: "Sales targets", description: "Open the Sales Targets page and set one's own gross-profit targets." },

  "finance.crosscheck.view": { category: "finance", label: "Financial Crosscheck", description: "Open the Financial Crosscheck page and download its CSV." },

  "reports.technical.view": { category: "reports", label: "Technical Reports", description: "Open the Technical Reports page and download its export." },

  "audit.view": { category: "audit-system", label: "View audit log", description: "Open the Audit Logs page and see recent administrative activity." },
  "system.monitor": { category: "audit-system", label: "System health", description: "Open the System page (database and runtime health)." },
  "system.backup": { category: "audit-system", label: "Backups", description: "Create and list database backups." },
  "theme.switch": { category: "audit-system", label: "Theme switcher", description: "Show the theme switcher in the header (a display preference only)." },
  "settings.view": { category: "audit-system", label: "View SLA policies", description: "Open the SLA Policies page." },
  "settings.manage": { category: "audit-system", label: "Manage SLA policies", description: "Change the SLA range and the email templates of SOA and Purchasing." },
};

export type CatalogPermission = { permission: Permission; label: string; description: string };

/** Every permission under its category, in the order of ALL_PERMISSIONS. Categories are never empty. */
export function permissionsByCategory(): { id: PermissionCategoryId; title: string; description: string; permissions: CatalogPermission[] }[] {
  return PERMISSION_CATEGORIES.map((category) => ({
    ...category,
    permissions: ALL_PERMISSIONS.filter((permission) => PERMISSION_CATALOG[permission].category === category.id).map((permission) => ({
      permission,
      label: PERMISSION_CATALOG[permission].label,
      description: PERMISSION_CATALOG[permission].description,
    })),
  }));
}

/** The roles shown as columns, in their usual order. */
export const EDITOR_ROLES = ROLES;

/** How the editor form names one role/permission cell ("SALES|projects.view"); neither part contains the separator. */
const CELL_SEPARATOR = "|";

export function cellKey(role: string, permission: string): string {
  return `${role}${CELL_SEPARATOR}${permission}`;
}

export function parseCellKey(cell: string): { role: string; permission: string } {
  const [role = "", permission = ""] = cell.split(CELL_SEPARATOR);
  return { role, permission };
}
