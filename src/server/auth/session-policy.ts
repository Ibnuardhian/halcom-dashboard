/**
 * How long a login lasts. Kept free of server-only imports so the rules can be unit-tested.
 *
 * A session lasts `SESSION_TTL_MS` from the moment it was last renewed, and is renewed while the person keeps working, but
 * never lives longer than `SESSION_MAX_AGE_MS` after sign-in: a stolen or forgotten browser cannot stay signed in forever,
 * and a person must authenticate again at least once a week. Both are the assumptions of docs/requirements/RBAC.md until
 * the product owner decides otherwise.
 */
const HOUR_MS = 60 * 60 * 1000;

function hoursFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const hours = Number(raw);
  // A mistyped value must not silently disable expiry, so anything outside the range falls back to the default.
  return Number.isFinite(hours) && hours >= min && hours <= max ? hours : fallback;
}

/** Idle lifetime: how long a session stays valid after sign-in or its last renewal. Default 12 hours (SESSION_TTL_HOURS, 1 to 72). */
export const SESSION_TTL_MS = hoursFromEnv("SESSION_TTL_HOURS", 12, 1, 72) * HOUR_MS;

/** Absolute lifetime: the longest a session can live, whatever the activity. Default 7 days (SESSION_MAX_HOURS, 1 to 720). */
export const SESSION_MAX_AGE_MS = Math.max(SESSION_TTL_MS, hoursFromEnv("SESSION_MAX_HOURS", 7 * 24, 1, 720) * HOUR_MS);

/** A session is renewed only once less than this much of its idle lifetime is left, so most requests write nothing. */
export const SESSION_RENEW_WHEN_LEFT_MS = SESSION_TTL_MS / 2;

export type SessionTimes = { createdAt: Date; expiresAt: Date };

/**
 * The new expiry of a session at `now`, or null when it should not change: it already expired, it has plenty of time left, or it
 * is already at its absolute limit.
 */
export function renewedExpiry({ createdAt, expiresAt }: SessionTimes, now: Date): Date | null {
  if (expiresAt.getTime() <= now.getTime()) return null;
  if (expiresAt.getTime() - now.getTime() >= SESSION_RENEW_WHEN_LEFT_MS) return null;
  const limit = createdAt.getTime() + SESSION_MAX_AGE_MS;
  const next = Math.min(now.getTime() + SESSION_TTL_MS, limit);
  return next > expiresAt.getTime() ? new Date(next) : null;
}

export type CookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  expires: Date;
};

/**
 * The attributes of the session cookie. HttpOnly keeps scripts from reading it, SameSite=Lax keeps other sites from making the
 * browser send it with a form post, and Secure is required in production (browsers accept it on http://localhost, so local
 * Docker still works). The cookie carries only an opaque random token.
 */
export function sessionCookieOptions(expires: Date, nodeEnv: string | undefined = process.env.NODE_ENV): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: nodeEnv === "production", path: "/", expires };
}
