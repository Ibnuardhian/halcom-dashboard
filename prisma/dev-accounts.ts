import { writeFile } from "node:fs/promises";
import { ROLES } from "@/domain/access/roles";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEV_ACCOUNTS_FILE, renderDevAccountsMarkdown, seedEmailFor } from "./seed-users";

/**
 * Rewrites the git-ignored sign-in cheat sheet: the role accounts plus every other active
 * `@example.invalid` account (the people created by the sales-export import). Development only.
 */
export async function writeDevAccountsFile(db: PrismaClient, password: string): Promise<void> {
  const roleEmails = new Set(ROLES.map(seedEmailFor));
  const users = await db.user.findMany({
    where: { email: { endsWith: "@example.invalid" }, isActive: true },
    select: { name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const named = users.filter((user) => !roleEmails.has(user.email));
  const baseUrl = `http://localhost:${process.env["APP_HOST_PORT"] ?? "3000"}`;
  await writeFile(DEV_ACCOUNTS_FILE, renderDevAccountsMarkdown(password, baseUrl, new Date(), named), "utf8");
  console.log(`Wrote ${DEV_ACCOUNTS_FILE} (git-ignored) with ${named.length} named account(s).`);
}
