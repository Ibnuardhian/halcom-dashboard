"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  parseThemeMode,
  resolveIsDark,
  THEME_LABELS,
  THEME_MODES,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "./theme";

const CHANGE_EVENT = "theme-change";

function readMode(): ThemeMode {
  try {
    return parseThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return parseThemeMode(null); // storage blocked: stay on the default
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function applyTheme(mode: ThemeMode): void {
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", resolveIsDark(mode, systemPrefersDark));
}

/** Per-browser theme choice for development. Rendered for superadmin only (permission `theme.switch`). */
export function ThemeSwitcher() {
  const mode = useSyncExternalStore(subscribe, readMode, () => parseThemeMode(null));

  // Keep the page in step with the stored mode, and with the OS while the mode is "system".
  useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(mode);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  function choose(next: ThemeMode) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode, policy): the choice cannot be remembered, so nothing changes.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <select
      aria-label="Theme"
      value={mode}
      onChange={(event) => choose(parseThemeMode(event.target.value))}
      className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    >
      {THEME_MODES.map((option) => (
        <option key={option} value={option}>
          {THEME_LABELS[option]}
        </option>
      ))}
    </select>
  );
}
