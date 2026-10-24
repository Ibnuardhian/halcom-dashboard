import { writeFile } from "node:fs/promises";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEV_ACCOUNTS_FILE, renderDevAccountsMarkdown } from "./seed-users";

/**
 * Rewrites the git-ignored accounts sheet from the database: every `@halcominovasi.co.id` account with how many projects it owns, and the
 * operational PICs. It holds no password. Development only.
 */
export async function writeDevAccountsFile(db: PrismaClient): Promise<void> {
  const [users, pics] = await Promise.all([
    db.user.findMany({
      where: { email: { endsWith: "@halcominovasi.co.id" } },
      select: { name: true, email: true, role: true, isActive: true, _count: { select: { ownedProjects: { where: { deletedAt: null } } } } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    db.pic.findMany({ select: { name: true, team: true, isActive: true }, orderBy: [{ team: "asc" }, { name: "asc" }] }),
  ]);
  const accounts = users.map((user) => ({ name: user.name, email: user.email, role: user.role, isActive: user.isActive, projects: user._count.ownedProjects }));
  const baseUrl = `http://localhost:${process.env["APP_HOST_PORT"] ?? "3000"}`;
  await writeFile(DEV_ACCOUNTS_FILE, renderDevAccountsMarkdown(baseUrl, new Date(), accounts, pics), "utf8");
  console.log(`Wrote ${DEV_ACCOUNTS_FILE} (git-ignored, no password) with ${accounts.length} account(s) and ${pics.length} PIC(s).`);
}
