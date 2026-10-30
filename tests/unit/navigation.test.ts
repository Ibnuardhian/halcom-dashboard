import { describe, expect, it } from "vitest";
import { can, clearPermissionOverrides, setPermissionOverrides, type Permission } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { navLinksFor, navSectionsFor } from "@/features/navigation/links";

const hrefsFor = (role: (typeof ROLES)[number]) => navLinksFor(role).map((l) => l.href);

/** The permission the destination page requires; each menu entry must be backed by it. */
function permissionFor(href: string): Permission {
  if (href === "/dashboard") return "dashboard.shared.view";
  if (href.startsWith("/dashboard/")) return `dashboard.${href.split("/").pop()}.view` as Permission;
  if (href === "/projects") return "projects.view";
  if (href === "/projects/new") return "projects.create.external";
  if (href === "/targets") return "targets.edit";
  if (href === "/customers") return "customers.view";
  if (href === "/requests/new") return "requests.create";
  if (href.startsWith("/requests")) return "requests.view";
  if (href === "/handoffs") return "handoffs.view";
  if (href === "/reports/technical") return "reports.technical.view";
  if (href === "/finance/crosscheck") return "finance.crosscheck.view";
  if (href === "/admin/users") return "users.view";
  if (href === "/admin/permissions") return "permissions.view";
  if (href === "/admin/audit") return "audit.view";
  if (href === "/admin/backups") return "system.backup";
  if (href === "/admin/system") return "system.monitor";
  if (href.startsWith("/admin/settings")) return "settings.view";
  if (href === "/admin/master-data") return "masterdata.manage";
  if (href === "/admin/pics") return "pics.manage";
  throw new Error(`No permission mapped for ${href}`);
}

const labelsFor = (role: (typeof ROLES)[number]) => navLinksFor(role).map((l) => [l.href, l.label]);

describe("navLinksFor", () => {
  it("shows Sales their pipeline, projects, request center and targets", () => {
    expect(labelsFor("SALES")).toEqual([
      ["/dashboard", "Overview"],
      ["/dashboard/sales", "Sales Pipeline"],
      ["/projects", "Projects"],
      ["/customers", "Customers"],
      ["/targets", "Sales Targets"],
      ["/requests", "Request Center"],
    ]);
  });

  it("shows SOA its technical dashboard, projects, BOQ tickets, handoff, reports and master data", () => {
    expect(labelsFor("SOA")).toEqual([
      ["/dashboard", "Overview"],
      ["/dashboard/soa", "Technical Dashboard"],
      ["/projects", "Projects"],
      ["/requests/boq", "BOQ Tickets"],
      ["/handoffs", "Purchasing Handoff"],
      ["/reports/technical", "Technical Reports"],
      ["/admin/master-data", "Principal & Solution Master Data"],
    ]);
  });

  it("shows Purchasing a focused menu: its dashboard, RFQ requests and PO requests; no overview, projects, BOQ or all-requests entry", () => {
    expect(labelsFor("PURCHASING")).toEqual([
      ["/dashboard/purchasing", "Purchasing Dashboard"],
      ["/requests/rfq", "RFQ Requests"],
      ["/requests/po", "PO requests"],
    ]);
  });

  it("shows Finance its dashboard, projects and the financial crosscheck, and nothing it could change", () => {
    expect(labelsFor("FINANCE")).toEqual([
      ["/dashboard", "Overview"],
      ["/dashboard/finance", "Finance Dashboard"],
      ["/projects", "Projects"],
      ["/requests", "All requests"],
      ["/requests/boq", "BOQ requests"],
      ["/requests/rfq", "RFQ requests"],
      ["/requests/po", "PO requests"],
      ["/finance/crosscheck", "Financial Crosscheck"],
    ]);
  });

  it("offers New request in the menu to admins only; Sales start requests from the Sales Pipeline page", () => {
    for (const role of ROLES) {
      expect(hrefsFor(role).includes("/requests/new")).toBe(["SUPERADMIN", "ADMIN"].includes(role));
    }
  });

  it("shows admin every dashboard but its own comes first, plus the administration modules, and no superadmin dashboard", () => {
    const links = navLinksFor("ADMIN");

    expect(links.slice(0, 3).map((l) => [l.href, l.label])).toEqual([
      ["/dashboard", "Overview"],
      ["/dashboard/admin", "Admin Dashboard"],
      ["/dashboard/sales", "Sales dashboard"],
    ]);
    const labels = links.map((l) => l.label);
    for (const label of ["Users and Roles", "Permissions", "SLA SOA", "SLA Purchasing", "Master Data", "Audit Logs"]) expect(labels).toContain(label);
    const hrefs = links.map((l) => l.href);
    expect(hrefs).not.toContain("/dashboard/superadmin");
    expect(hrefs).not.toContain("/admin/backups");
    expect(hrefs).not.toContain("/admin/system");
  });

  it("shows superadmin everything", () => {
    const hrefs = hrefsFor("SUPERADMIN");

    for (const expected of ["/dashboard/superadmin", "/projects", "/projects/new", "/requests/new", "/handoffs", "/finance/crosscheck", "/reports/technical", "/admin/users", "/admin/permissions", "/admin/audit", "/admin/backups", "/admin/system", "/admin/settings/soa", "/admin/settings/purchasing", "/admin/master-data", "/admin/pics"]) {
      expect(hrefs).toContain(expected);
    }
    // Admin and Superadmin share one Admin Dashboard (D-032): the menu offers it once, under the user's own address.
    expect(hrefs).not.toContain("/dashboard/admin");
    expect(navLinksFor("SUPERADMIN").filter((l) => l.label === "Admin Dashboard")).toHaveLength(1);
  });

  it("offers a shared dashboard once even when a role is given both addresses", () => {
    setPermissionOverrides([
      { role: "MANAGEMENT", permission: "dashboard.admin.view", granted: true },
      { role: "MANAGEMENT", permission: "dashboard.superadmin.view", granted: true },
    ]);
    try {
      const adminLinks = navLinksFor("MANAGEMENT").filter((l) => l.href === "/dashboard/admin" || l.href === "/dashboard/superadmin");
      expect(adminLinks).toHaveLength(1);
    } finally {
      clearPermissionOverrides();
    }
  });

  it("offers Backups and System to superadmin only, and the SLA modules to admins and superadmin", () => {
    for (const role of ROLES) {
      expect(hrefsFor(role).includes("/admin/settings/soa") && hrefsFor(role).includes("/admin/settings/purchasing")).toBe(role === "SUPERADMIN" || role === "ADMIN");
      expect(hrefsFor(role).includes("/admin/backups")).toBe(role === "SUPERADMIN");
      expect(hrefsFor(role).includes("/admin/system")).toBe(role === "SUPERADMIN");
    }
  });

  it("offers the permission matrix to admins only", () => {
    for (const role of ROLES) expect(hrefsFor(role).includes("/admin/permissions")).toBe(role === "SUPERADMIN" || role === "ADMIN");
  });

  it("only links to pages the role may open, and has no duplicates", () => {
    for (const role of ROLES) {
      const hrefs = hrefsFor(role);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) {
        expect(can(role, permissionFor(href)), `${role} ${href}`).toBe(true);
      }
    }
  });
});

describe("navSectionsFor", () => {
  it("groups links under Dashboards, Work and Administration and drops empty sections", () => {
    expect(navSectionsFor("SUPERADMIN").map((s) => s.label)).toEqual(["Dashboards", "Work", "Administration"]);
    expect(navSectionsFor("FINANCE").map((s) => s.label)).toEqual(["Dashboards", "Work"]);
  });

  it("keeps every link, once, in its section", () => {
    for (const role of ROLES) {
      const fromSections = navSectionsFor(role).flatMap((s) => s.links.map((l) => l.href));
      expect(fromSections.sort()).toEqual(hrefsFor(role).sort());
    }
  });
});
