import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedScheme = "light" | "dark";

const STORAGE_KEY = "studio-theme";

function readStored(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    /* storage unavailable; fall through to the default */
  }
  return "system";
}

function matchSystemDark(): boolean {
  try {
    return (
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false
    );
  } catch {
    return false;
  }
}

/** Applies the resolved preference to the document root as `data-theme`. */
export function applyThemeToRoot(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = preference;
  }
}

/**
 * Theme hook. Follows the OS colour scheme by default, while letting the app
 * detect the current scheme and explicitly oppose it (`setTheme("light" |
 * "dark")`). The explicit choice is persisted to localStorage and applied to
 * the `<html data-theme>` attribute, which the shared `themes.css` maps to the
 * light/dark `--studio-*` palettes.
 */
export function useTheme() {
  const [preference, setPreference] =
    useState<ThemePreference>(readStored);
  const [systemScheme, setSystemScheme] = useState<ResolvedScheme>(() =>
    matchSystemDark() ? "dark" : "light",
  );

  // Keep `systemScheme` in sync with the OS while the app is running, so an
  // in-session OS switch is reflected immediately.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setSystemScheme(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Apply the resolved theme to the root and persist the explicit choice.
  useEffect(() => {
    applyThemeToRoot(preference);
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* storage unavailable; the theme still applies for this session */
    }
  }, [preference]);

  const resolved: ResolvedScheme =
    preference === "system" ? systemScheme : preference;

  const setTheme = useCallback(
    (next: ThemePreference) => setPreference(next),
    [],
  );

  return { preference, resolved, setTheme };
}
