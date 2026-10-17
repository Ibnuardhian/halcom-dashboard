import { describe, expect, it } from "vitest";
import { can, type Permission } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { navLinksFor, navSectionsFor } from "@/features/navigation/links";

const hrefsFor = (role: (typeof ROLES)[number]) => navLinksFor(role).map((l) => l.href);

/** The permission the destination page requires; each menu entry must be backed by it. */
function permissionFor(href: string): Permission {
  if (href === "/dashboard") return "dashboard.shared.view";
  if (href.startsWith("/dashboard/")) return `dashboard.${href.split("/").pop()}.view` as Permission;
  if (href === "/projects") return "projects.view";
  if (href === "/requests/new") return "requests.create";
  if (href.startsWith("/requests")) return "requests.view";
  if (href === "/admin/users") return "users.view";
  if (href === "/admin/audit") return "audit.view";
  if (href === "/admin/backups") return "system.backup";
  if (href === "/admin/system") return "system.monitor";
  throw new Error(`No permission mapped for ${href}`);
}

describe("navLinksFor", () => {
  it("shows Purchasing its dashboards and the read-only work modules, nothing else", () => {
    expect(hrefsFor("PURCHASING")).toEqual([
      "/dashboard",
      "/dashboard/purchasing",
      "/projects",
      "/requests",
      "/requests/boq",
      "/requests/rfq",
      "/requests/po",
    ]);
  });

  it("offers New request only to roles that can create requests", () => {
    for (const role of ROLES) {
      expect(hrefsFor(role).includes("/requests/new")).toBe(["SUPERADMIN", "ADMIN", "SALES"].includes(role));
    }
  });

  it("shows admin every dashboard but its own comes first, plus Users and the audit log, and no superadmin dashboard", () => {
    const links = navLinksFor("ADMIN");

    expect(links.slice(0, 3).map((l) => [l.href, l.label])).toEqual([
      ["/dashboard", "Overview"],
      ["/dashboard/admin", "My dashboard"],
      ["/dashboard/sales", "Sales dashboard"],
    ]);
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toContain("/admin/users");
    expect(hrefs).toContain("/admin/audit");
    expect(hrefs).not.toContain("/dashboard/superadmin");
    expect(hrefs).not.toContain("/admin/backups");
    expect(hrefs).not.toContain("/admin/system");
  });

  it("shows superadmin everything", () => {
    const hrefs = hrefsFor("SUPERADMIN");

    expect(hrefs).toHaveLength(2 + 6 + 6 + 4); // overview + own + 6 other dashboards, 6 work links, 4 administration links
    for (const expected of ["/dashboard/admin", "/projects", "/requests/new", "/admin/users", "/admin/audit", "/admin/backups", "/admin/system"]) {
      expect(hrefs).toContain(expected);
    }
  });

  it("offers Backups and System to superadmin only", () => {
    for (const role of ROLES) {
      expect(hrefsFor(role).includes("/admin/backups")).toBe(role === "SUPERADMIN");
      expect(hrefsFor(role).includes("/admin/system")).toBe(role === "SUPERADMIN");
    }
  });

  it("only links to pages the role may open, and has no duplicates", () => {
    for (const role of ROLES) {
      const hrefs = hrefsFor(role);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) expect(can(role, permissionFor(href)), `${role} ${href}`).toBe(true);
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
