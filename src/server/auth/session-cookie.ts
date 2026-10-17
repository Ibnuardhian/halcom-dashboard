import { cookies } from "next/headers";

const COOKIE_NAME = "session";

/** The cookie carries only an opaque random token; the session itself lives in the database. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // Browsers accept Secure cookies on http://localhost, so local Docker still works.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_NAME)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
