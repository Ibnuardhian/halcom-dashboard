import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { can, type Permission } from "@/domain/access/permissions";
import { getDb } from "@/lib/db";
import { readSessionToken } from "./session-cookie";
import { findSessionUser, type SessionUser } from "./session-store";

/**
 * The signed-in user for this request, read fresh from the database (role and
 * active flag are never trusted from the cookie). Deduplicated per request.
 * Reads cookies, so callers must render inside a <Suspense> boundary.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // Session checks compare against the current time, so they must never run while prerendering.
  await connection();
  const token = await readSessionToken();
  return token ? findSessionUser(getDb(), token) : null;
});

/** Redirects to the login page when nobody is signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Server-side authorization for pages and actions: sign-in required, then the
 * permission. A missing permission renders the not-found UI with none of the page's
 * content, so a forbidden URL looks the same as one that does not exist. The HTTP
 * status stays 200: Cache Components streams the response before this check runs.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) notFound();
  return user;
}
