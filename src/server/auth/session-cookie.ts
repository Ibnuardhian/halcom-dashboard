import { cookies } from "next/headers";
import { sessionCookieOptions } from "./session-policy";

const COOKIE_NAME = "session";

/** The cookie carries only an opaque random token; the session itself lives in the database. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(COOKIE_NAME, token, sessionCookieOptions(expiresAt));
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_NAME)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
