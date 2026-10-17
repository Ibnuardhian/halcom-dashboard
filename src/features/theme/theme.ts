export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Everyone starts on light; only a superadmin sees the control that changes it (D-016). */
export const DEFAULT_THEME: ThemeMode = "light";
export const THEME_STORAGE_KEY = "theme";

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

/** An unknown or missing stored value falls back to the default instead of failing. */
export function parseThemeMode(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : DEFAULT_THEME;
}

export function resolveIsDark(mode: ThemeMode, systemPrefersDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemPrefersDark);
}

/**
 * Runs in <head> before the first paint so the page never flashes the wrong theme.
 * It repeats the rules of parseThemeMode and resolveIsDark in plain JavaScript;
 * a unit test executes it against the same cases.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
