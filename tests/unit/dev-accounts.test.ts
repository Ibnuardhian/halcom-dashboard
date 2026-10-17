import { describe, expect, it } from "vitest";
import { ROLES } from "@/domain/access/roles";
import { renderDevAccountsMarkdown, seedEmailFor } from "../../prisma/seed-users";

describe("renderDevAccountsMarkdown", () => {
  const markdown = renderDevAccountsMarkdown("pw-for-test-123", "http://localhost:3000", new Date("2026-10-17T09:30:45Z"));

  it("lists one row per role with its email, password and landing page", () => {
    for (const role of ROLES) {
      const row = markdown.split("\n").find((line) => line.includes(`\`${seedEmailFor(role)}\``));
      expect(row, role).toBeDefined();
      expect(row).toContain("`pw-for-test-123`");
      expect(row).toContain(`\`/dashboard/${role.toLowerCase()}\``);
    }
  });

  it("warns that the file must not be committed, links to the login page and stamps the time", () => {
    expect(markdown).toContain("Do not commit this file");
    expect(markdown).toContain("http://localhost:3000/login");
    expect(markdown).toContain("2026-10-17 09:30 UTC");
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
