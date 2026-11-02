import { describe, expect, it } from "vitest";
import { buildEml } from "@/domain/requests/eml";

const decode = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

describe("buildEml", () => {
  const long = "Detail baris satu\nBaris dua dengan é dan 日本\n".repeat(80);
  const eml = buildEml({ to: ["po@halcominovasi.co.id"], cc: ["a@x.id", "b@x.id"], subject: "[HITPO] PT Çontoh - Proyek 日本 yang sangat panjang sekali untuk diuji", body: long });
  const [head, ...rest] = eml.split("\r\n\r\n");

  it("is an unsent draft with the recipients", () => {
    expect(head).toContain("X-Unsent: 1");
    expect(head).toContain("To: po@halcominovasi.co.id");
    expect(head).toContain("Cc: a@x.id, b@x.id");
  });

  it("keeps the whole text, however long, and its line breaks", () => {
    const text = decode(rest.join("").replace(/\r\n/g, ""));
    expect(text).toBe(long.replace(/\n/g, "\r\n"));
    expect(Math.max(...rest.join("").split("\r\n").map((line) => line.length))).toBeLessThanOrEqual(76);
  });

  it("encodes the subject in short words that decode back", () => {
    const words = [...head.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((match) => decode(match[1]!));
    expect(words.join("")).toBe("[HITPO] PT Çontoh - Proyek 日本 yang sangat panjang sekali untuk diuji");
    expect(head.split("\r\n").every((line) => line.length <= 78)).toBe(true);
  });

  it("leaves out To and Cc when there are none", () => {
    expect(buildEml({ to: [], cc: [], subject: "s", body: "b" })).not.toMatch(/^(To|Cc):/m);
  });
});
