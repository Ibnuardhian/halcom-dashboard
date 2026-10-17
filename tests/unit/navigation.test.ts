import { describe, expect, it } from "vitest";
import { can } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { navLinksFor } from "@/features/navigation/links";

describe("navLinksFor", () => {
  it("shows an operational role the overview and its own dashboard only", () => {
    expect(navLinksFor("SOA")).toEqual([
      { href: "/dashboard", label: "Overview" },
      { href: "/dashboard/soa", label: "My dashboard" },
    ]);
  });

  it("shows admin every dashboard but its own comes first, plus Users, and no superadmin dashboard", () => {
    const links = navLinksFor("ADMIN");

    expect(links.slice(0, 3)).toEqual([
      { href: "/dashboard", label: "Overview" },
      { href: "/dashboard/admin", label: "My dashboard" },
      { href: "/dashboard/sales", label: "Sales dashboard" },
    ]);
    expect(links.map((l) => l.href)).toContain("/admin/users");
    expect(links.map((l) => l.href)).not.toContain("/dashboard/superadmin");
  });

  it("shows superadmin everything", () => {
    const hrefs = navLinksFor("SUPERADMIN").map((l) => l.href);

    expect(hrefs).toHaveLength(2 + 6 + 1); // overview, own + 6 others, users
    expect(hrefs).toContain("/dashboard/admin");
  });

  it("only links to pages the role may open, and has no duplicates", () => {
    for (const role of ROLES) {
      const hrefs = navLinksFor(role).map((l) => l.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const href of hrefs) {
        if (href === "/admin/users") expect(can(role, "users.view")).toBe(true);
        else if (href === "/dashboard") expect(can(role, "dashboard.shared.view")).toBe(true);
        else expect(can(role, `dashboard.${href.split("/").pop()}.view` as never)).toBe(true);
      }
    }
  });
});
