/**
 * How password guessing is slowed down (T-7). Pure rules, so they can be read and tested without a database.
 *
 * Every failed sign-in is counted twice: once against the e-mail that was typed and once against the address it came from.
 * The e-mail counter stops someone guessing one person's password; the address counter stops them spraying one password over many
 * accounts. A counter that has not been touched for `WINDOW_MINUTES` starts again, and a successful sign-in clears both, so an
 * office where people mistype is not punished.
 *
 * The lock is always temporary (at most `MAX_LOCK_MINUTES`): a permanent lockout would let anyone keep a colleague out by
 * typing a wrong password often enough.
 *
 * The e-mail counter is kept whether or not an account with that address exists, so a locked message never tells an outsider
 * which addresses are real.
 */

export type ThrottleScope = "email" | "ip";

/** Failures inside one window before the scope is locked. */
export const MAX_FAILURES: Record<ThrottleScope, number> = {
  // A person who has forgotten their password tries a handful of times; five is past that.
  email: 5,
  // One address may carry a whole office behind one NAT, so it is given far more room; it only ever counts failures.
  ip: 25,
};

/** A counter untouched for this long starts again. */
export const WINDOW_MINUTES = 15;

/** The first lock; it doubles for every further block of failures. */
export const BASE_LOCK_MINUTES = 15;

/** However many failures follow, the lock never lasts longer than this. */
export const MAX_LOCK_MINUTES = 60;

const MINUTE_MS = 60_000;

/** What the database holds for one scope and key. */
export type AttemptRecord = { failures: number; lastFailedAt: Date; lockedUntil: Date | null };

/** Whether a counter has gone cold: the next failure starts from one again. */
export function windowExpired(record: AttemptRecord, now: Date): boolean {
  return now.getTime() - record.lastFailedAt.getTime() >= WINDOW_MINUTES * MINUTE_MS;
}

/**
 * How long a scope stays locked after `failures` failures: nothing below the limit, then 15 minutes, doubling for every further
 * block of failures, capped at an hour.
 */
export function lockMinutesFor(scope: ThrottleScope, failures: number): number {
  const limit = MAX_FAILURES[scope];
  if (failures < limit) return 0;
  const blocks = Math.floor(failures / limit);
  return Math.min(MAX_LOCK_MINUTES, BASE_LOCK_MINUTES * 2 ** (blocks - 1));
}

/** The record as it should be stored after one more failure. */
export function afterFailure(previous: AttemptRecord | null, scope: ThrottleScope, now: Date): AttemptRecord {
  const failures = previous === null || windowExpired(previous, now) ? 1 : previous.failures + 1;
  const minutes = lockMinutesFor(scope, failures);
  return { failures, lastFailedAt: now, lockedUntil: minutes === 0 ? null : new Date(now.getTime() + minutes * MINUTE_MS) };
}

/** Whole minutes left of a lock, rounded up, so "try again in 1 minute" is never shown while seconds remain. */
export function lockMinutesLeft(record: AttemptRecord | null, now: Date): number {
  if (!record?.lockedUntil) return 0;
  const remaining = record.lockedUntil.getTime() - now.getTime();
  return remaining <= 0 ? 0 : Math.ceil(remaining / MINUTE_MS);
}

/** True while the scope is locked; an expired lock is simply over. */
export function isLocked(record: AttemptRecord | null, now: Date): boolean {
  return lockMinutesLeft(record, now) > 0;
}

/**
 * What the sign-in page says while a lock lasts. It says nothing about the account, so it reads the same whether or not the
 * address belongs to anyone.
 */
export function lockedMessage(minutesLeft: number): string {
  return `Too many sign-in attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`;
}
