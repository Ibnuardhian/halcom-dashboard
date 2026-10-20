import { cookies } from "next/headers";
import { z } from "zod";
import { isRole, type Role } from "@/domain/access/roles";

/**
 * The accounts that signed in on this browser, so the sign-in page can offer them as a quick pick when someone switches
 * account. It holds only what is printed on the login page anyway (name, email, role) and never a password, a session token
 * or any proof of identity: choosing an account only fills the email box, and the password is still required. The cookie is
 * HttpOnly, so scripts cannot read it, and every entry can be removed from the sign-in page.
 */
const COOKIE_NAME = "recent_accounts";
const MAX_ACCOUNTS = 5;
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

export type RecentAccount = { email: string; name: string; role: Role };

const entrySchema = z.object({ email: z.string().max(254), name: z.string().max(100), role: z.string() });

/** Parses the cookie value defensively: anything malformed, oversized or tampered with is dropped, never trusted. */
export function parseRecentAccounts(raw: string | undefined): RecentAccount[] {
  if (!raw || raw.length > 4000) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const accounts: RecentAccount[] = [];
  for (const item of json) {
    const entry = entrySchema.safeParse(item);
    if (!entry.success || !isRole(entry.data.role)) continue;
    const email = entry.data.email.trim().toLowerCase();
    if (!z.email().safeParse(email).success || accounts.some((account) => account.email === email)) continue;
    accounts.push({ email, name: entry.data.name, role: entry.data.role });
    if (accounts.length === MAX_ACCOUNTS) break;
  }
  return accounts;
}

/** The new list after `account` signed in: it moves to the front, the oldest entries fall off. */
export function withAccount(list: readonly RecentAccount[], account: RecentAccount): RecentAccount[] {
  return [account, ...list.filter((entry) => entry.email !== account.email)].slice(0, MAX_ACCOUNTS);
}

export async function readRecentAccounts(): Promise<RecentAccount[]> {
  return parseRecentAccounts((await cookies()).get(COOKIE_NAME)?.value);
}

async function write(list: readonly RecentAccount[]): Promise<void> {
  const jar = await cookies();
  if (list.length === 0) {
    jar.delete(COOKIE_NAME);
    return;
  }
  jar.set(COOKIE_NAME, JSON.stringify(list), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: THIRTY_DAYS_S,
  });
}

export async function rememberAccount(account: RecentAccount): Promise<void> {
  await write(withAccount(await readRecentAccounts(), account));
}

export async function forgetAccount(email: string): Promise<void> {
  const wanted = email.trim().toLowerCase();
  await write((await readRecentAccounts()).filter((account) => account.email !== wanted));
}

export async function forgetAllAccounts(): Promise<void> {
  await write([]);
}
