import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { findSessionUser, renewSession } from "@/server/auth/session-store";

// Never cached: the answer depends on the caller's cookie and on the clock.
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Keeps a signed-in person signed in while they work: the page asks now and then, and a session that is close to its idle
 * expiry gets a new one (up to its absolute limit, see session-policy.ts). 401 tells the page the session is gone, so it can
 * send the person to sign in instead of failing on their next click. The route reveals nothing but the outcome.
 */
export async function POST(): Promise<NextResponse> {
  const token = await readSessionToken();
  const db = getDb();
  if (!token || !(await findSessionUser(db, token))) return NextResponse.json({ signedIn: false }, { status: 401, headers: NO_STORE });

  const expiresAt = await renewSession(db, token);
  if (expiresAt) await setSessionCookie(token, expiresAt);
  return NextResponse.json({ signedIn: true, renewed: expiresAt !== null }, { headers: NO_STORE });
}
