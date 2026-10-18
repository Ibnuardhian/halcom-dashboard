import type { Role } from "./roles";

/**
 * Remembering an account on a browser, so Switch Account needs no password. Accounts that can change other people's access
 * (ADMIN, SUPERADMIN) are never remembered: switching to them always asks for the password.
 */
export function canRememberDevice(role: Role): boolean {
  return role !== "ADMIN" && role !== "SUPERADMIN";
}

/** How long a remembered account stays usable without the password, counted from the sign-in that created it. */
export const DEVICE_CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** At most this many accounts are remembered on one browser. */
export const MAX_REMEMBERED_ACCOUNTS = 5;
