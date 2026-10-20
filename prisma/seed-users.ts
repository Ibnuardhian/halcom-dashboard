import { homePathFor } from "@/domain/access/dashboards";
import { seedEmailFor, seedNameFor } from "@/domain/devdata/accounts";
import { ROLE_LABELS, ROLES, type Role } from "@/domain/access/roles";

/** Synthetic development/test accounts: one per role, all sharing the password in SEED_USER_PASSWORD. */
export const SEED_PASSWORD_ENV = "SEED_USER_PASSWORD";

/** Written by the development seed and the sales-export import. Git-ignored and Docker-ignored; it holds no password or other secret. */
export const DEV_ACCOUNTS_FILE = "DEV_ACCOUNTS.md";

export { seedEmailFor, seedNameFor };

export type DevAccount = { name: string; email: string; role: Role; isActive: boolean; projects: number };
export type DevPic = { name: string; team: "SOA" | "PURCHASING"; isActive: boolean };

/**
 * Accounts that came from the sales export and are no longer how the team is organised (D-031). `npm run db:cleanup-dev` (D-032) deletes
 * the ones nothing refers to and deactivates the ones the audit trail or the projects still point at, so those stay listed here and the
 * cheat sheet says so instead of letting a developer sign in as them. Importing the export again creates them again; run
 * `db:remap-owners` and `db:cleanup-dev` after it.
 */
export const OBSOLETE_DEV_ACCOUNTS: Readonly<Record<string, string>> = {
  "gusti@example.invalid": "Projects moved to Satrio (satrio@example.invalid).",
  "soraya@example.invalid": "Projects moved to Dzaki (dzaki@example.invalid).",
  "hendi.batam@example.invalid": "The project is now source Other (no internal Sales PIC).",
  "jihan.batam@example.invalid": "The project is now source Other (no internal Sales PIC).",
  "mira.batam@example.invalid": "The project is now source Other (no internal Sales PIC).",
  "tim.batam@example.invalid": "The project is now source Other (no internal Sales PIC).",
  "ibnu.ardhiansyah@example.invalid": "Sender of tickets in the RFQ tracker (D-035); the account exists only so history can name them. Inactive, nobody knows its password.",
  "adityo@example.invalid": "SOA signs in with the shared SOA account; Adityo is now a PIC (an assignee), not a login. Kept because the history refers to this account.",
};

const cell = (text: string) => text.replaceAll("|", "\\|");

/**
 * Renders the development accounts sheet. It never contains a password or any other secret: the password of the synthetic accounts is
 * the value of `SEED_USER_PASSWORD` in your own `.env`. Pure, so a unit test can check it.
 */
export function renderDevAccountsMarkdown(baseUrl: string, generatedAt: Date, accounts: readonly DevAccount[] = [], pics: readonly DevPic[] = []): string {
  const roleEmails = new Set(ROLES.map(seedEmailFor));
  const system = ROLES.map((role) => ({ role, email: seedEmailFor(role), found: accounts.find((account) => account.email === seedEmailFor(role)) }));
  const people = accounts.filter((account) => !roleEmails.has(account.email));
  const current = people.filter((account) => !(account.email in OBSOLETE_DEV_ACCOUNTS));
  const obsolete = people.filter((account) => account.email in OBSOLETE_DEV_ACCOUNTS);
  const shared: Partial<Record<Role, string>> = {
    SOA: "Shared login of the whole SOA team. Tickets are handed to PICs, not to this account.",
    PURCHASING: "Shared login of the whole Purchasing team. Tickets are handed to PICs, not to this account.",
  };

  const lines = [
    "# Development accounts",
    "",
    "> **Local development only. Do not commit this file.** It is listed in `.gitignore` and `.dockerignore`. It holds no password or other secret:",
    "> every account below uses the password in `SEED_USER_PASSWORD` in your own `.env`. The accounts are synthetic and exist only in the development database.",
    "",
    `Open ${baseUrl}/login and sign in with an email below.`,
    "",
    "## System accounts (one per role)",
    "",
    "| Role | Email | Lands on | Notes |",
    "|---|---|---|---|",
    ...system.map(({ role, email, found }) => `| ${ROLE_LABELS[role]} | \`${email}\` | \`${homePathFor(role)}\` | ${cell(shared[role] ?? "")}${found && !found.isActive ? " (inactive)" : ""} |`),
    "",
    "SOA and Purchasing each sign in with **one shared system account**. The people who do the work are **PICs** (below), which are not accounts.",
    "",
    "## Sales accounts",
    "",
    "Sales accounts own projects. A project is owned by exactly one of them (source **Internal Sales**) or by none (source **Other**).",
    "",
    ...(current.length === 0
      ? ["None besides the role account above.", ""]
      : [
          "| Name | Email | Projects owned |",
          "|---|---|---|",
          ...current.map((account) => `| ${cell(account.name)} | \`${account.email}\` | ${account.projects}${account.isActive ? "" : " (inactive)"} |`),
          "",
        ]),
    "## Operational PICs (not login accounts)",
    "",
    "A PIC is who a SOA or Purchasing ticket is assigned to. An administrator keeps the list at `/admin/pics`. **Workload by assignee** counts requests per PIC.",
    "",
    ...(pics.length === 0
      ? ["No PIC has been created yet.", ""]
      : [
          "| PIC | Team | Active | Notes |",
          "|---|---|---|---|",
          ...pics.map((pic) => {
            // The first migration made a PIC of every account a request was assigned to; a shared login is no person.
            const fromSharedLogin = accounts.some((account) => account.name === pic.name && (account.role === "SOA" || account.role === "PURCHASING") && roleEmails.has(account.email));
            return `| ${cell(pic.name)} | ${pic.team === "SOA" ? "SOA" : "Purchasing"} | ${pic.isActive ? "yes" : "no"} | ${fromSharedLogin ? "Made from the shared login's earlier assignments. Hand its requests to a real PIC, then deactivate it." : ""} |`;
          }),
          "",
        ]),
    "## Project source Other",
    "",
    "- **Internal Sales**: the project has a Sales PIC (one of the Sales accounts above). Sales register their own; SOA register one for a salesperson they pick.",
    "- **Other**: work from an external sales company or another source. No Sales account owns it; the project records the external sales name instead. Only SOA (and administrators) register or classify these.",
    "- A project whose earlier owner is not one of the Sales accounts that keep projects was moved to **Other**, with that person's name kept as the external sales name and a note.",
    "",
    "## Obsolete accounts",
    "",
    ...(obsolete.length === 0
      ? ["None."]
      : [
          "These exist only because history refers to them (nothing is deleted). Do not use them for new work; remove or deactivate them on the Users page when you no longer need the history to resolve to a login.",
          "",
          "| Name | Email | Role | Projects owned | Why |",
          "|---|---|---|---|---|",
          ...obsolete.map((account) => `| ${cell(account.name)} | \`${account.email}\` | ${ROLE_LABELS[account.role]} | ${account.projects} | ${cell(OBSOLETE_DEV_ACCOUNTS[account.email]!)} |`),
        ]),
    "",
    "Notes:",
    "",
    `- Generated by \`npm run db:seed\` or \`npm run db:import-projects\` on ${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    "- The seed never overwrites existing users. If a password was reset on the Users page, or `SEED_USER_PASSWORD` changed after the accounts were created, the real password can differ.",
    "- Superadmin also sees the System page and the theme switcher; Admin can manage the operational users and the PICs.",
    "",
  ];
  return lines.join("\n");
}
