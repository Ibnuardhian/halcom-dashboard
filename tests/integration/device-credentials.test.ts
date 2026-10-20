import { afterAll, describe, expect, it } from "vitest";
import { DEVICE_CREDENTIAL_TTL_MS } from "@/domain/access/device";
import { getDb } from "@/lib/db";
import { changeOwnPassword } from "@/server/auth/account";
import {
  consumeDeviceCredential,
  hashDeviceToken,
  issueDeviceCredential,
  revokeDeviceCredential,
  verifyDeviceCredential,
} from "@/server/auth/device-credentials";
import { revokeAllSessions } from "@/server/auth/session-store";
import { TEST_PASSWORD, makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("remembered accounts (device credentials)", () => {
  it("stores only a salted hash of the token, never the token", async () => {
    const user = await makeUser("SALES");

    const { id, token } = await issueDeviceCredential(db, user.id);

    const row = await db.deviceCredential.findUniqueOrThrow({ where: { id } });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.tokenHash).toBe(hashDeviceToken(row.salt, token));
    expect(row.tokenHash).not.toBe(hashDeviceToken("another salt", token)); // the salt is part of the hash
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(DEVICE_CREDENTIAL_TTL_MS);
    await expect(verifyDeviceCredential(db, { id, token })).resolves.toMatchObject({ id: user.id, role: "SALES", email: user.email });
  });

  it("refuses a wrong token, an unknown id and an expired credential", async () => {
    const user = await makeUser("SOA");
    const { id, token } = await issueDeviceCredential(db, user.id);

    await expect(verifyDeviceCredential(db, { id, token: `${token.slice(1)}x` })).resolves.toBeNull();
    await expect(verifyDeviceCredential(db, { id: "00000000-0000-4000-8000-000000000000", token })).resolves.toBeNull();
    const later = new Date(Date.now() + DEVICE_CREDENTIAL_TTL_MS + 1000);
    await expect(verifyDeviceCredential(db, { id, token }, later)).resolves.toBeNull();
    await expect(db.deviceCredential.count({ where: { id } })).resolves.toBe(0); // an expired one is removed
  });

  it("is refused for a user who was deactivated since, or whose role became ADMIN or SUPERADMIN, and the credential goes", async () => {
    const [off, promoted, root] = await Promise.all([makeUser("FINANCE"), makeUser("PURCHASING"), makeUser("MANAGEMENT")]);
    const a = await issueDeviceCredential(db, off.id);
    const b = await issueDeviceCredential(db, promoted.id);
    const c = await issueDeviceCredential(db, root.id);

    await db.user.update({ where: { id: off.id }, data: { isActive: false } });
    await db.user.update({ where: { id: promoted.id }, data: { role: "ADMIN" } });
    await db.user.update({ where: { id: root.id }, data: { role: "SUPERADMIN" } });

    for (const credential of [a, b, c]) {
      await expect(verifyDeviceCredential(db, credential)).resolves.toBeNull();
      await expect(db.deviceCredential.count({ where: { id: credential.id } })).resolves.toBe(0);
    }
  });

  it("follows the current role of the user, not what the browser remembered", async () => {
    const user = await makeUser("SALES");
    const credential = await issueDeviceCredential(db, user.id);
    await db.user.update({ where: { id: user.id }, data: { role: "SOA" } });

    await expect(verifyDeviceCredential(db, credential)).resolves.toMatchObject({ role: "SOA" });
  });

  it("replaces the token on every use, so a copied cookie works at most once, and two uses at once cannot both succeed", async () => {
    const user = await makeUser("SALES");
    const first = await issueDeviceCredential(db, user.id);

    const used = await consumeDeviceCredential(db, first);
    expect(used).toMatchObject({ user: { id: user.id } });
    expect(used?.token).not.toBe(first.token);
    await expect(consumeDeviceCredential(db, first)).resolves.toBeNull(); // the old token is dead
    await expect(verifyDeviceCredential(db, { id: first.id, token: used!.token })).resolves.toMatchObject({ id: user.id });

    const race = await Promise.all(Array.from({ length: 5 }, () => consumeDeviceCredential(db, { id: first.id, token: used!.token })));
    expect(race.filter((result) => result !== null)).toHaveLength(1);
  });

  it("ends when the credential is revoked, when the password changes, and when the account is deactivated or reset", async () => {
    const user = await makeUser("SALES");
    const a = await issueDeviceCredential(db, user.id);
    await revokeDeviceCredential(db, a.id);
    await expect(verifyDeviceCredential(db, a)).resolves.toBeNull();

    const b = await issueDeviceCredential(db, user.id);
    const changed = await changeOwnPassword(db, user.id, undefined, { currentPassword: TEST_PASSWORD, newPassword: "a-brand-new-password-1" });
    expect(changed.ok).toBe(true);
    await expect(verifyDeviceCredential(db, b)).resolves.toBeNull();

    const c = await issueDeviceCredential(db, user.id);
    await revokeAllSessions(db, user.id); // what deactivating an account and an admin's reset call
    await expect(verifyDeviceCredential(db, c)).resolves.toBeNull();
  });

  it("does not touch another user's credentials", async () => {
    const [one, two] = await Promise.all([makeUser("SALES"), makeUser("SALES")]);
    const mine = await issueDeviceCredential(db, one.id);
    const theirs = await issueDeviceCredential(db, two.id);

    await revokeAllSessions(db, one.id);

    await expect(verifyDeviceCredential(db, mine)).resolves.toBeNull();
    await expect(verifyDeviceCredential(db, theirs)).resolves.toMatchObject({ id: two.id });
    // One user's token never opens another user's credential.
    await expect(verifyDeviceCredential(db, { id: theirs.id, token: mine.token })).resolves.toBeNull();
  });

  it("is removed with its user", async () => {
    const user = await makeUser("SALES");
    const { id } = await issueDeviceCredential(db, user.id);

    await db.user.delete({ where: { id: user.id } });

    await expect(db.deviceCredential.count({ where: { id } })).resolves.toBe(0);
  });
});
