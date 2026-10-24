import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt with N=2^16, r=8, p=1 (about 64 MiB per hash), within OWASP's guidance.
const COST = { N: 2 ** 16, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 128 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

function deriveKey(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...cost, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Returns `scrypt$N$r$p$salt$hash` (base64), so the cost can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
}

function isAcceptableCost(N: number, r: number, p: number): boolean {
  const powerOfTwo = Number.isInteger(N) && N >= 2 ** 14 && N <= 2 ** 17 && (N & (N - 1)) === 0;
  return powerOfTwo && Number.isInteger(r) && r >= 1 && r <= 16 && Number.isInteger(p) && p >= 1 && p <= 4;
}

/** Constant-time check. Malformed or out-of-policy stored hashes verify as false rather than throwing. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, nRaw, rRaw, pRaw, saltRaw, keyRaw] = stored.split("$");
  if (scheme !== "scrypt" || !saltRaw || !keyRaw) return false;
  const [N, r, p] = [Number(nRaw), Number(rRaw), Number(pRaw)];
  if (!isAcceptableCost(N, r, p)) return false;

  const expected = Buffer.from(keyRaw, "base64");
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await deriveKey(password, Buffer.from(saltRaw, "base64"), { N, r, p });
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check, so response time does not reveal whether
 * an email address belongs to an account.
 */
export async function spendPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("unused-placeholder-password");
  await verifyPassword(password, await dummyHash);
}
