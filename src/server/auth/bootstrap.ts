import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeEmail } from "./authenticate";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";

/**
 * The first superadmin of a database that has none (T-8). The seed refuses to run outside development and test, so without this a
 * production database would have no way in at all; with it there is exactly one way, and only while no superadmin exists.
 *
 * The account must replace its password at the first sign-in, and the creation is audited, so the account cannot be made quietly.
 */

/** Serialises two runs against one database, so a race cannot create two first superadmins. */
const BOOTSTRAP_LOCK = 7_201_027;

const bootstrapSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name."),
  email: z
    .string()
    .trim()
    .transform(normalizeEmail)
    .pipe(z.email("That is not an e-mail address.")),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `The password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `The password must be at most ${PASSWORD_MAX_LENGTH} characters.`),
});

export type BootstrapResult =
  | { ok: true; created: true; id: string; email: string }
  /** A superadmin already exists, so nothing was created. Their addresses say who to ask for an account. */
  | { ok: true; created: false; existing: string[] }
  | { ok: false; message: string };

export async function bootstrapFirstSuperadmin(db: PrismaClient, input: unknown, options: { dryRun?: boolean } = {}): Promise<BootstrapResult> {
  const parsed = bootstrapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { name, email, password } = parsed.data;

  const existing = await db.user.findMany({ where: { role: "SUPERADMIN" }, select: { email: true }, orderBy: { email: "asc" } });
  if (existing.length > 0) return { ok: true, created: false, existing: existing.map((user) => user.email) };
  if (options.dryRun) return { ok: true, created: false, existing: [] };

  const taken = await db.user.findUnique({ where: { email }, select: { role: true } });
  if (taken) return { ok: false, message: `${email} already has an account (${taken.role}). Give it the Superadmin role on the Users page instead.` };

  // Hashing is slow by design, so it happens before the transaction opens.
  const passwordHash = await hashPassword(password);
  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`;
    // Checked again inside the lock: between the first look and here, another run may have created one.
    if ((await tx.user.count({ where: { role: "SUPERADMIN" } })) > 0) return null;
    const user = await tx.user.create({
      data: { name, email, role: "SUPERADMIN", passwordHash, isActive: true, mustChangePassword: true },
      select: { id: true, email: true },
    });
    await tx.auditEvent.create({
      data: { actorId: user.id, action: "user.bootstrapped", entityType: "user", entityId: user.id, after: { email: user.email, role: "SUPERADMIN" } },
    });
    return user;
  });
  if (!created) {
    const now = await db.user.findMany({ where: { role: "SUPERADMIN" }, select: { email: true } });
    return { ok: true, created: false, existing: now.map((user) => user.email) };
  }
  return { ok: true, created: true, id: created.id, email: created.email };
}
