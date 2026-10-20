"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { homePathFor } from "@/domain/access/dashboards";
import { canRememberDevice } from "@/domain/access/device";
import { getDb } from "@/lib/db";
import { authenticate } from "@/server/auth/authenticate";
import { consumeDeviceCredential, issueDeviceCredential, revokeDeviceCredential } from "@/server/auth/device-credentials";
import { dropAllDeviceEntries, dropDeviceEntry, readDeviceEntries, storeDeviceEntry } from "@/server/auth/device-cookie";
import { forgetAccount, forgetAllAccounts, rememberAccount } from "@/server/auth/recent-accounts";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { createSession, findSessionUser, revokeSession } from "@/server/auth/session-store";
import { loginSchema } from "@/server/users/schemas";

export type LoginState = { error: string } | null;

// One message for every failure, so the form never reveals which emails exist.
const LOGIN_FAILED = "Invalid email or password.";

/** Drops every cached page of the app (server and browser router cache), so the next person never sees the last one's data. */
function forgetCachedPages(): void {
  revalidatePath("/", "layout");
}

/** Remembers the account on this browser, replacing an older credential of the same user so the list never shows one account twice. */
async function rememberThisBrowser(db: ReturnType<typeof getDb>, userId: string): Promise<void> {
  const entries = await readDeviceEntries();
  const older = entries.length === 0 ? [] : await db.deviceCredential.findMany({ where: { id: { in: entries.map((entry) => entry.id) }, userId }, select: { id: true } });
  for (const row of older) {
    await revokeDeviceCredential(db, row.id);
    await dropDeviceEntry(row.id);
  }
  await storeDeviceEntry(await issueDeviceCredential(db, userId));
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: LOGIN_FAILED };

  const db = getDb();
  const user = await authenticate(db, parsed.data.email, parsed.data.password);
  if (!user) return { error: LOGIN_FAILED };

  // A browser holds one session. Signing in as someone else (a stale tab, a shared workstation) ends the old one first.
  const previous = await readSessionToken();
  if (previous) await revokeSession(db, previous);

  const { token, expiresAt } = await createSession(db, user.id);
  await setSessionCookie(token, expiresAt);
  await rememberAccount({ email: user.email, name: user.name, role: user.role });
  // Every sign-in remembers the account on this browser so Switch Account needs no password later (never ADMIN or SUPERADMIN).
  if (canRememberDevice(user.role)) await rememberThisBrowser(db, user.id);
  await db.auditEvent.create({ data: { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id } });
  forgetCachedPages();
  redirect(homePathFor(user.role));
}

/** Ends the session and clears the cookie. Nothing signs the person back in afterwards: the next visit shows the sign-in page. */
export async function logoutAction(): Promise<void> {
  await endSession("auth.logout");
  redirect("/login");
}

/**
 * Switch Account: ends the current session first, then shows the sign-in page with the accounts used on this browser. Choosing
 * one only fills in its email; the person still has to enter that account's password, so switching never lets anyone become
 * another user without authenticating.
 */
export async function switchAccountAction(): Promise<void> {
  await endSession("auth.switch");
  redirect("/login?switch=1");
}

async function endSession(action: "auth.logout" | "auth.switch"): Promise<void> {
  const db = getDb();
  const token = await readSessionToken();
  if (token) {
    const user = await findSessionUser(db, token);
    await revokeSession(db, token);
    if (user) await db.auditEvent.create({ data: { actorId: user.id, action, entityType: "user", entityId: user.id } });
  }
  await clearSessionCookie();
  forgetCachedPages();
}

/**
 * Signs in as an account this browser remembered, without the password. The credential is checked against the stored record (still
 * active, still a role that may be remembered, not expired, token matches its salted hash) and its token is replaced by a new one. If any
 * check fails the entry is dropped and the person is sent to the sign-in page, where the password is asked as usual.
 */
export async function switchToRememberedAction(formData: FormData): Promise<void> {
  const id = formData.get("credentialId");
  const entry = typeof id === "string" ? (await readDeviceEntries()).find((candidate) => candidate.id === id) : undefined;
  const db = getDb();
  const used = entry ? await consumeDeviceCredential(db, entry) : null;
  if (!entry || !used) {
    if (entry) await dropDeviceEntry(entry.id);
    redirect("/login?switch=1");
  }

  const previous = await readSessionToken();
  if (previous) await revokeSession(db, previous);
  const { token, expiresAt } = await createSession(db, used.user.id);
  await setSessionCookie(token, expiresAt);
  await storeDeviceEntry({ id: entry.id, token: used.token });
  await rememberAccount({ email: used.user.email, name: used.user.name, role: used.user.role });
  await db.auditEvent.create({ data: { actorId: used.user.id, action: "auth.switch_remembered", entityType: "user", entityId: used.user.id } });
  forgetCachedPages();
  redirect(homePathFor(used.user.role));
}

/** Stops remembering one account on this browser: its stored credential is deleted, so the password is asked again. */
export async function forgetRememberedAccountAction(formData: FormData): Promise<void> {
  const id = formData.get("credentialId");
  if (typeof id === "string" && (await readDeviceEntries()).some((entry) => entry.id === id)) {
    await revokeDeviceCredential(getDb(), id);
    await dropDeviceEntry(id);
  }
  redirect("/login?switch=1");
}

/** Removes one account from the quick-pick list of this browser (a shared workstation can clear what was left behind). */
export async function forgetRecentAccountAction(formData: FormData): Promise<void> {
  const email = formData.get("email");
  if (typeof email === "string") await forgetAccount(email);
  redirect("/login?switch=1");
}

export async function forgetAllRecentAccountsAction(): Promise<void> {
  const db = getDb();
  for (const entry of await readDeviceEntries()) await revokeDeviceCredential(db, entry.id);
  await dropAllDeviceEntries();
  await forgetAllAccounts();
  redirect("/login");
}
