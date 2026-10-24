import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { afterFailure, isLocked, lockMinutesLeft, WINDOW_MINUTES, type AttemptRecord, type ThrottleScope } from "@/domain/access/login-throttle";
import { normalizeEmail } from "./authenticate";

/**
 * The counters behind the sign-in throttle (T-7). They live in the database, not in memory, because the application runs as several
 * server instances (and on Vercel as short-lived functions): a counter in memory would be reset by the next request.
 */

type Db = Pick<PrismaClient, "loginAttempt">;

/**
 * A client address is personal data and is never needed again, so only a SHA-256 of it is stored. The hash is enough to count
 * failures from the same address, and tells nobody who it was.
 */
export function addressKey(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}

/**
 * The address of whoever is signing in, read from the proxy headers Vercel and a reverse proxy set. The leftmost entry of
 * `x-forwarded-for` is the client; the rest are proxies. Null when no header says (a direct call in development), and then only
 * the e-mail counter applies.
 */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || null;
}

/** The keys one attempt is counted under: always the e-mail, and the address when it is known. */
export function keysFor(email: string, address: string | null): { scope: ThrottleScope; key: string }[] {
  const keys: { scope: ThrottleScope; key: string }[] = [{ scope: "email", key: normalizeEmail(email) }];
  if (address) keys.push({ scope: "ip", key: addressKey(address) });
  return keys;
}

export type LockState = { locked: boolean; minutesLeft: number };

/** Whether either counter is locked, and for how much longer. Read before the password is checked at all. */
export async function lockState(db: Db, email: string, address: string | null, now: Date = new Date()): Promise<LockState> {
  const keys = keysFor(email, address);
  const rows = await db.loginAttempt.findMany({
    where: { OR: keys.map((entry) => ({ scope: entry.scope, key: entry.key })) },
    select: { failures: true, lastFailedAt: true, lockedUntil: true },
  });
  const minutesLeft = Math.max(0, ...rows.map((row) => lockMinutesLeft(row, now)));
  return { locked: rows.some((row) => isLocked(row, now)), minutesLeft };
}

/**
 * Counts one failed sign-in against both keys and says what the person is told. Every attempt is counted, whether or not the
 * e-mail belongs to an account, so a lock never reveals which addresses are real.
 */
export async function recordFailure(db: Db, email: string, address: string | null, now: Date = new Date()): Promise<LockState> {
  let minutesLeft = 0;
  let locked = false;
  for (const { scope, key } of keysFor(email, address)) {
    const previous = await db.loginAttempt.findUnique({ where: { scope_key: { scope, key } }, select: { failures: true, lastFailedAt: true, lockedUntil: true } });
    const next: AttemptRecord = afterFailure(previous, scope, now);
    await db.loginAttempt.upsert({
      where: { scope_key: { scope, key } },
      create: { scope, key, failures: next.failures, firstFailedAt: now, lastFailedAt: now, lockedUntil: next.lockedUntil },
      update: { failures: next.failures, lastFailedAt: now, lockedUntil: next.lockedUntil, ...(next.failures === 1 ? { firstFailedAt: now } : {}) },
    });
    const left = lockMinutesLeft(next, now);
    if (left > 0) {
      locked = true;
      minutesLeft = Math.max(minutesLeft, left);
    }
  }
  return { locked, minutesLeft };
}

/** A successful sign-in clears both counters, so one person's typing does not creep towards a lock over the weeks. */
export async function clearFailures(db: Db, email: string, address: string | null): Promise<void> {
  const keys = keysFor(email, address);
  await db.loginAttempt.deleteMany({ where: { OR: keys.map((entry) => ({ scope: entry.scope, key: entry.key })) } });
}

/**
 * Removes counters nobody is watching any more (nothing failed for a window and no lock is left). The table would otherwise keep a
 * row for every address that ever mistyped. Called after a successful sign-in, which is rare enough to be a good moment.
 */
export async function purgeColdAttempts(db: Db, now: Date = new Date()): Promise<number> {
  const cold = new Date(now.getTime() - WINDOW_MINUTES * 60_000);
  const { count } = await db.loginAttempt.deleteMany({ where: { lastFailedAt: { lt: cold }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } });
  return count;
}
