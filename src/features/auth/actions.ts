"use server";

import { redirect } from "next/navigation";
import { homePathFor } from "@/domain/access/dashboards";
import { getDb } from "@/lib/db";
import { authenticate } from "@/server/auth/authenticate";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { createSession, revokeSession } from "@/server/auth/session-store";
import { loginSchema } from "@/server/users/schemas";

export type LoginState = { error: string } | null;

// One message for every failure, so the form never reveals which emails exist.
const LOGIN_FAILED = "Invalid email or password.";

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: LOGIN_FAILED };

  const db = getDb();
  const user = await authenticate(db, parsed.data.email, parsed.data.password);
  if (!user) return { error: LOGIN_FAILED };

  const { token, expiresAt } = await createSession(db, user.id);
  await setSessionCookie(token, expiresAt);
  redirect(homePathFor(user.role));
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await revokeSession(getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}
