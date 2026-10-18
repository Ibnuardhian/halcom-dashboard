"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { homePathFor } from "@/domain/access/dashboards";
import { getDb } from "@/lib/db";
import { authenticate } from "@/server/auth/authenticate";
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

/** Removes one account from the quick-pick list of this browser (a shared workstation can clear what was left behind). */
export async function forgetRecentAccountAction(formData: FormData): Promise<void> {
  const email = formData.get("email");
  if (typeof email === "string") await forgetAccount(email);
  redirect("/login?switch=1");
}

export async function forgetAllRecentAccountsAction(): Promise<void> {
  await forgetAllAccounts();
  redirect("/login");
}
