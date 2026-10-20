import { describe, expect, it } from "vitest";
import { canRememberDevice, MAX_REMEMBERED_ACCOUNTS } from "@/domain/access/device";
import { ROLES } from "@/domain/access/roles";
import { parseDeviceEntries, withDeviceEntry, withoutDeviceEntry } from "@/server/auth/device-policy";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = (c: string) => c.repeat(43);

describe("canRememberDevice", () => {
  it("remembers every role except the two that manage other people's access", () => {
    expect(ROLES.filter((role) => !canRememberDevice(role)).sort()).toEqual(["ADMIN", "SUPERADMIN"]);
    for (const role of ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) expect(canRememberDevice(role)).toBe(true);
  });
});

describe("parseDeviceEntries", () => {
  it("reads id and token pairs, and nothing else from the cookie", () => {
    const raw = JSON.stringify([{ id: id(1), token: token("a"), name: "Dev Sales", email: "x@example.invalid", role: "SALES" }]);

    expect(parseDeviceEntries(raw)).toEqual([{ id: id(1), token: token("a") }]);
  });

  it("drops malformed input, bad ids, bad tokens and duplicates, and never throws", () => {
    expect(parseDeviceEntries(undefined)).toEqual([]);
    expect(parseDeviceEntries("not json")).toEqual([]);
    expect(parseDeviceEntries('{"id":1}')).toEqual([]);
    expect(parseDeviceEntries("x".repeat(5000))).toEqual([]);
    const raw = JSON.stringify([
      { id: "nope", token: token("a") },
      { id: id(1), token: "short" },
      { id: id(2), token: `${token("b")}!!` },
      { id: id(3), token: token("c") },
      { id: id(3), token: token("d") },
      null,
      "text",
    ]);
    expect(parseDeviceEntries(raw)).toEqual([{ id: id(3), token: token("c") }]);
  });

  it("keeps at most the limit", () => {
    const raw = JSON.stringify(Array.from({ length: MAX_REMEMBERED_ACCOUNTS + 3 }, (_, n) => ({ id: id(n + 1), token: token("a") })));

    expect(parseDeviceEntries(raw)).toHaveLength(MAX_REMEMBERED_ACCOUNTS);
  });
});

describe("the remembered list", () => {
  it("puts a new or renewed entry first, never twice, and drops the oldest at the limit", () => {
    let list = [] as ReturnType<typeof parseDeviceEntries>;
    for (let n = 1; n <= MAX_REMEMBERED_ACCOUNTS + 1; n += 1) list = withDeviceEntry(list, { id: id(n), token: token("a") });

    expect(list).toHaveLength(MAX_REMEMBERED_ACCOUNTS);
    expect(list[0]!.id).toBe(id(MAX_REMEMBERED_ACCOUNTS + 1));
    expect(list.map((entry) => entry.id)).not.toContain(id(1));
    const renewed = withDeviceEntry(list, { id: id(3), token: token("z") });
    expect(renewed[0]).toEqual({ id: id(3), token: token("z") });
    expect(renewed.filter((entry) => entry.id === id(3))).toHaveLength(1);
    expect(withoutDeviceEntry(renewed, id(3)).map((entry) => entry.id)).not.toContain(id(3));
  });
});
