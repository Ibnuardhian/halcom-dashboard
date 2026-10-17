import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("password hashing", () => {
  it("verifies the correct password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("correct horse battery stapl", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("salts every hash and never stores the password", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password-123"), hashPassword("same-password-123")]);

    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$65536\$8\$1\$/);
    expect(a).not.toContain("same-password-123");
  });

  it("treats canonically equivalent unicode as the same password", async () => {
    const hash = await hashPassword("café-password-1"); // precomposed é

    await expect(verifyPassword("café-password-1", hash)).resolves.toBe(true); // e + combining accent
  });

  it("returns false for malformed or out-of-policy stored hashes instead of throwing", async () => {
    const valid = await hashPassword("some-password-123");
    const [, , r, p, salt, key] = valid.split("$");
    const malformed = [
      "",
      "plain-text",
      "bcrypt$65536$8$1$abc$def",
      "scrypt$65536$8$1$only-four-parts",
      `scrypt$3$${r}$${p}$${salt}$${key}`, // N not a power of two
      `scrypt$${2 ** 30}$${r}$${p}$${salt}$${key}`, // memory-exhaustion attempt
      `scrypt$65536$${r}$${p}$${salt}$c2hvcnQ=`, // wrong key length
    ];

    for (const stored of malformed) {
      await expect(verifyPassword("some-password-123", stored)).resolves.toBe(false);
    }
  });
});
