import { describe, expect, it } from "vitest";
import { renewedExpiry, SESSION_MAX_AGE_MS, SESSION_RENEW_WHEN_LEFT_MS, SESSION_TTL_MS, sessionCookieOptions } from "@/server/auth/session-policy";
import { parseRecentAccounts, withAccount } from "@/server/auth/recent-accounts";

const at = (ms: number) => new Date(Date.UTC(2026, 9, 18, 0, 0, 0) + ms);

describe("session lifetime", () => {
  it("keeps the idle lifetime shorter than the absolute one", () => {
    expect(SESSION_TTL_MS).toBeGreaterThan(0);
    expect(SESSION_MAX_AGE_MS).toBeGreaterThanOrEqual(SESSION_TTL_MS);
    expect(SESSION_RENEW_WHEN_LEFT_MS).toBe(SESSION_TTL_MS / 2);
  });

  it("does not renew a session that still has most of its time", () => {
    const createdAt = at(0);
    expect(renewedExpiry({ createdAt, expiresAt: at(SESSION_TTL_MS) }, at(1_000))).toBeNull();
    expect(renewedExpiry({ createdAt, expiresAt: at(SESSION_TTL_MS) }, at(SESSION_TTL_MS - SESSION_RENEW_WHEN_LEFT_MS - 1))).toBeNull();
  });

  it("renews a session in its last half, for a full idle lifetime from now", () => {
    const createdAt = at(0);
    const now = at(SESSION_TTL_MS - SESSION_RENEW_WHEN_LEFT_MS + 1);

    expect(renewedExpiry({ createdAt, expiresAt: at(SESSION_TTL_MS) }, now)).toEqual(new Date(now.getTime() + SESSION_TTL_MS));
  });

  it("never renews a session that already expired, so a lapsed login needs a new authentication", () => {
    const createdAt = at(0);
    expect(renewedExpiry({ createdAt, expiresAt: at(SESSION_TTL_MS) }, at(SESSION_TTL_MS))).toBeNull();
    expect(renewedExpiry({ createdAt, expiresAt: at(SESSION_TTL_MS) }, at(SESSION_TTL_MS + 60_000))).toBeNull();
  });

  it("never lets a session live past its absolute limit", () => {
    const createdAt = at(0);
    const nearEnd = at(SESSION_MAX_AGE_MS - 60_000);

    // Close to the limit the renewal is cut at the limit...
    const cut = renewedExpiry({ createdAt, expiresAt: at(SESSION_MAX_AGE_MS - 30_000) }, nearEnd);
    expect(cut === null || cut.getTime() <= createdAt.getTime() + SESSION_MAX_AGE_MS).toBe(true);
    // ...and a session already at the limit is not extended at all.
    expect(renewedExpiry({ createdAt, expiresAt: at(SESSION_MAX_AGE_MS) }, nearEnd)).toBeNull();
  });
});

describe("session cookie attributes", () => {
  const expires = at(SESSION_TTL_MS);

  it("is HttpOnly, SameSite=Lax, site-wide, and expires with the session", () => {
    expect(sessionCookieOptions(expires, "development")).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/", expires });
  });

  it("is Secure in production", () => {
    expect(sessionCookieOptions(expires, "production").secure).toBe(true);
    expect(sessionCookieOptions(expires, "test").secure).toBe(false);
  });
});

describe("recent accounts cookie", () => {
  const account = (n: number, role = "SALES") => ({ email: `user${n}@example.com`, name: `User ${n}`, role });

  it("reads a valid list and drops malformed, duplicate, unknown-role and invalid-email entries", () => {
    const raw = JSON.stringify([account(1), account(1), account(2, "ROOT"), { email: "not-an-email", name: "x", role: "SALES" }, { name: "no email" }, "junk", account(3, "SOA")]);

    expect(parseRecentAccounts(raw)).toEqual([account(1), account(3, "SOA")]);
  });

  it("treats anything that is not a JSON array as an empty list", () => {
    for (const raw of [undefined, "", "not json", "{}", "null", "x".repeat(5000)]) expect(parseRecentAccounts(raw)).toEqual([]);
  });

  it("keeps at most five accounts and lower-cases emails", () => {
    const raw = JSON.stringify([1, 2, 3, 4, 5, 6, 7].map((n) => account(n)));
    expect(parseRecentAccounts(raw)).toHaveLength(5);
    expect(parseRecentAccounts(JSON.stringify([{ ...account(1), email: "USER1@Example.com" }]))[0]?.email).toBe("user1@example.com");
  });

  it("moves the account that just signed in to the front, without duplicates, and drops the oldest", () => {
    const list = [1, 2, 3, 4, 5].map((n) => ({ ...account(n), role: "SALES" as const }));

    expect(withAccount(list, list[2]!).map((a) => a.email)).toEqual(["user3@example.com", "user1@example.com", "user2@example.com", "user4@example.com", "user5@example.com"]);
    expect(withAccount(list, { email: "new@example.com", name: "New", role: "SOA" }).map((a) => a.email)).toEqual([
      "new@example.com",
      "user1@example.com",
      "user2@example.com",
      "user3@example.com",
      "user4@example.com",
    ]);
  });

  it("never stores anything but name, email and role", () => {
    const parsed = parseRecentAccounts(JSON.stringify([{ ...account(1), password: "secret", token: "abc" }]));

    expect(Object.keys(parsed[0]!).sort()).toEqual(["email", "name", "role"]);
  });
});
