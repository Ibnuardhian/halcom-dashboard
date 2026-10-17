import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  isThemeMode,
  parseThemeMode,
  resolveIsDark,
  THEME_INIT_SCRIPT,
  THEME_MODES,
  THEME_STORAGE_KEY,
} from "@/features/theme/theme";

describe("theme rules", () => {
  it("defaults to light", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(parseThemeMode(undefined)).toBe("light");
    expect(parseThemeMode(null)).toBe("light");
    expect(parseThemeMode("purple")).toBe("light");
    expect(isThemeMode("Dark")).toBe(false);
  });

  it("resolves dark only for dark, or for system when the OS prefers dark", () => {
    expect(resolveIsDark("light", true)).toBe(false);
    expect(resolveIsDark("dark", false)).toBe(true);
    expect(resolveIsDark("system", true)).toBe(true);
    expect(resolveIsDark("system", false)).toBe(false);
  });
});

/** Runs the real head script in a stub browser and returns whether it turned dark mode on. */
function darkAfterInitScript(stored: string | null, systemPrefersDark: boolean, storageThrows = false): boolean {
  let dark = false;
  const sandbox = {
    localStorage: {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("storage blocked");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    },
    matchMedia: () => ({ matches: systemPrefersDark }),
    document: { documentElement: { classList: { toggle: (_name: string, on: boolean) => (dark = on) } } },
  };
  runInNewContext(THEME_INIT_SCRIPT, sandbox);
  return dark;
}

describe("THEME_INIT_SCRIPT", () => {
  it("agrees with resolveIsDark for every stored value and OS preference", () => {
    for (const stored of [...THEME_MODES, null, "garbage"]) {
      for (const systemPrefersDark of [true, false]) {
        expect(darkAfterInitScript(stored, systemPrefersDark), `${stored} / os dark=${systemPrefersDark}`).toBe(
          resolveIsDark(parseThemeMode(stored), systemPrefersDark),
        );
      }
    }
  });

  it("does not throw when storage is unavailable", () => {
    expect(darkAfterInitScript("dark", true, true)).toBe(false);
  });
});
