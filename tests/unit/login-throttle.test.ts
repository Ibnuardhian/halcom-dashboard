import { describe, expect, it } from "vitest";
import {
  afterFailure,
  BASE_LOCK_MINUTES,
  isLocked,
  lockedMessage,
  lockMinutesFor,
  lockMinutesLeft,
  MAX_FAILURES,
  MAX_LOCK_MINUTES,
  windowExpired,
  WINDOW_MINUTES,
  type AttemptRecord,
} from "@/domain/access/login-throttle";

const MINUTE = 60_000;
const now = new Date("2026-10-24T09:00:00Z");
const at = (minutes: number) => new Date(now.getTime() + minutes * MINUTE);

describe("how long a lock lasts", () => {
  it("does not lock below the limit of the scope", () => {
    for (let failures = 0; failures < MAX_FAILURES.email; failures += 1) expect(lockMinutesFor("email", failures)).toBe(0);
    expect(lockMinutesFor("ip", MAX_FAILURES.ip - 1)).toBe(0);
  });

  it("locks for a quarter of an hour at the limit and doubles for each further block, never past an hour", () => {
    expect(lockMinutesFor("email", 5)).toBe(BASE_LOCK_MINUTES);
    expect(lockMinutesFor("email", 9)).toBe(BASE_LOCK_MINUTES);
    expect(lockMinutesFor("email", 10)).toBe(30);
    expect(lockMinutesFor("email", 15)).toBe(MAX_LOCK_MINUTES);
    expect(lockMinutesFor("email", 500)).toBe(MAX_LOCK_MINUTES);
  });

  it("gives one address far more room than one e-mail, because an office shares an address", () => {
    expect(MAX_FAILURES.ip).toBeGreaterThan(MAX_FAILURES.email);
    expect(lockMinutesFor("ip", MAX_FAILURES.email)).toBe(0);
    expect(lockMinutesFor("ip", MAX_FAILURES.ip)).toBe(BASE_LOCK_MINUTES);
  });
});

describe("counting a failure", () => {
  it("starts at one and counts up inside the window", () => {
    let record: AttemptRecord = afterFailure(null, "email", now);
    expect(record).toMatchObject({ failures: 1, lockedUntil: null });
    for (let n = 2; n <= 4; n += 1) {
      record = afterFailure(record, "email", at(n));
      expect(record.failures).toBe(n);
      expect(record.lockedUntil).toBeNull();
    }
  });

  it("locks on the fifth failure and says when it ends", () => {
    let record = afterFailure(null, "email", now);
    for (let n = 2; n <= 5; n += 1) record = afterFailure(record, "email", now);
    expect(record.failures).toBe(5);
    expect(record.lockedUntil).toEqual(at(BASE_LOCK_MINUTES));
    expect(isLocked(record, now)).toBe(true);
    expect(lockMinutesLeft(record, at(5))).toBe(10);
  });

  it("starts again when nothing failed for a whole window, so an old typo never adds to today's", () => {
    const old: AttemptRecord = { failures: 4, lastFailedAt: now, lockedUntil: null };
    expect(windowExpired(old, at(WINDOW_MINUTES - 1))).toBe(false);
    expect(windowExpired(old, at(WINDOW_MINUTES))).toBe(true);
    expect(afterFailure(old, "email", at(WINDOW_MINUTES)).failures).toBe(1);
    expect(afterFailure(old, "email", at(WINDOW_MINUTES - 1)).failures).toBe(5);
  });

  it("never locks for good: however many attempts follow, an hour ends it", () => {
    let record = afterFailure(null, "email", now);
    for (let n = 0; n < 200; n += 1) record = afterFailure(record, "email", now);
    expect(lockMinutesLeft(record, now)).toBeLessThanOrEqual(MAX_LOCK_MINUTES);
    expect(isLocked(record, at(MAX_LOCK_MINUTES + 1))).toBe(false);
  });
});

describe("what is left of a lock", () => {
  it("is nothing without a record or a lock, and rounds up so it never says a minute that has passed", () => {
    expect(lockMinutesLeft(null, now)).toBe(0);
    expect(lockMinutesLeft({ failures: 2, lastFailedAt: now, lockedUntil: null }, now)).toBe(0);
    const locked: AttemptRecord = { failures: 5, lastFailedAt: now, lockedUntil: new Date(now.getTime() + 61_000) };
    expect(lockMinutesLeft(locked, now)).toBe(2);
    expect(lockMinutesLeft(locked, new Date(now.getTime() + 61_000))).toBe(0);
    expect(isLocked(locked, at(5))).toBe(false);
  });

  it("is worded without saying anything about the account", () => {
    expect(lockedMessage(1)).toBe("Terlalu banyak percobaan masuk. Coba lagi dalam 1 menit.");
    expect(lockedMessage(15)).toBe("Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.");
    expect(lockedMessage(15)).not.toMatch(/account|user|exist|email address/i);
  });
});
