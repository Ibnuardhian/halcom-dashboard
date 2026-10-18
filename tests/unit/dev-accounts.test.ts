import { describe, expect, it } from "vitest";
import { ROLES } from "@/domain/access/roles";
import { OBSOLETE_DEV_ACCOUNTS, renderDevAccountsMarkdown, seedEmailFor, type DevAccount } from "../../prisma/seed-users";

const account = (name: string, email: string, role: DevAccount["role"], projects = 0, isActive = true): DevAccount => ({ name, email, role, isActive, projects });

describe("renderDevAccountsMarkdown", () => {
  const accounts: DevAccount[] = [
    ...ROLES.map((role) => account(`Dev ${role}`, seedEmailFor(role), role)),
    account("Dzaki", "dzaki@example.invalid", "SALES", 15),
    account("Satrio", "satrio@example.invalid", "SALES", 18),
    account("Gusti", "gusti@example.invalid", "SALES", 0),
    account("Adityo", "adityo@example.invalid", "SOA", 0),
  ];
  const markdown = renderDevAccountsMarkdown("http://localhost:3000", new Date("2026-10-17T09:30:45Z"), accounts, [
    { name: "Adityo", team: "SOA", isActive: true },
    { name: "Ibnu", team: "PURCHASING", isActive: false },
  ]);

  it("lists one system account per role with its email and landing page, and says SOA and Purchasing share one login", () => {
    for (const role of ROLES) {
      const row = markdown.split("\n").find((line) => line.includes(`\`${seedEmailFor(role)}\``));
      expect(row, role).toBeDefined();
      expect(row).toContain(`\`/dashboard/${role.toLowerCase()}\``);
    }
    expect(markdown.split("\n").find((line) => line.includes("`soa@example.invalid`"))).toContain("Shared login of the whole SOA team");
    expect(markdown.split("\n").find((line) => line.includes("`purchasing@example.invalid`"))).toContain("Shared login of the whole Purchasing team");
  });

  it("never contains a password column or a password value, and names the .env setting instead", () => {
    expect(markdown).not.toMatch(/\|\s*Password\s*\|/i);
    expect(markdown).not.toMatch(/dev-only-change-me|pw-for-test/);
    expect(markdown).toContain("`SEED_USER_PASSWORD` in your own `.env`");
    // Nothing that looks like a secret is rendered from the account data either.
    expect(markdown).not.toMatch(/passwordHash|token/i);
  });

  it("shows the Sales accounts that own projects with their counts, apart from the obsolete ones", () => {
    const sales = markdown.slice(markdown.indexOf("## Sales accounts"), markdown.indexOf("## Operational PICs"));
    expect(sales).toContain("| Dzaki | `dzaki@example.invalid` | 15 |");
    expect(sales).toContain("| Satrio | `satrio@example.invalid` | 18 |");
    expect(sales).not.toContain("gusti@");
    expect(sales).not.toContain("adityo@");
  });

  it("separates the operational PICs from the accounts and shows who is inactive", () => {
    const pics = markdown.slice(markdown.indexOf("## Operational PICs"), markdown.indexOf("## Project source Other"));
    expect(pics).toContain("not login accounts");
    expect(pics).toContain("| Adityo | SOA | yes |");
    expect(pics).toContain("| Ibnu | Purchasing | no |");
    // A PIC that was made from a shared login (the first migration did that) is flagged so it gets handed on.
    const flagged = renderDevAccountsMarkdown("http://localhost:3000", new Date(), [account("Dev Soa", "soa@example.invalid", "SOA")], [{ name: "Dev Soa", team: "SOA", isActive: true }]);
    expect(flagged).toContain("Made from the shared login");
  });

  it("explains the Other source and lists the obsolete accounts with the reason, only the ones that exist", () => {
    expect(markdown).toContain("## Project source Other");
    expect(markdown).toContain("No Sales account owns it");
    const obsolete = markdown.slice(markdown.indexOf("## Obsolete accounts"));
    expect(obsolete).toContain("`gusti@example.invalid`");
    expect(obsolete).toContain(OBSOLETE_DEV_ACCOUNTS["gusti@example.invalid"]!);
    expect(obsolete).toContain("`adityo@example.invalid`");
    expect(obsolete).not.toContain("soraya@"); // not in this database
  });

  it("warns that the file must not be committed, links to the login page and stamps the time", () => {
    expect(markdown).toContain("Do not commit this file");
    expect(markdown).toContain("http://localhost:3000/login");
    expect(markdown).toContain("2026-10-17 09:30 UTC");
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("renders with no accounts or PICs yet", () => {
    const bare = renderDevAccountsMarkdown("http://localhost:3000", new Date("2026-10-17T09:30:45Z"));
    expect(bare).toContain("None besides the role account above.");
    expect(bare).toContain("No PIC has been created yet.");
  });
});
