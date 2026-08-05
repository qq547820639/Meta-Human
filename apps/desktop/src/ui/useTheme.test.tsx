import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTheme, type ThemePreference } from "./useTheme";

const themesCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "themes.css"),
  "utf8",
);

interface MatchMediaMock {
  matches: boolean;
  listeners: Array<(event: MediaQueryListEvent) => void>;
  media: string;
}

/** Controllable matchMedia mock so tests can flip the OS colour scheme. */
function installMatchMedia(initialDark: boolean) {
  const state: MatchMediaMock = {
    matches: initialDark,
    listeners: [],
    media: "(prefers-color-scheme: dark)",
  };
  const query = {
    get matches() {
      return state.matches;
    },
    media: state.media,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      state.listeners.push(cb);
    },
    removeEventListener: (
      _type: string,
      cb: (e: MediaQueryListEvent) => void,
    ) => {
      state.listeners = state.listeners.filter((l) => l !== cb);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query as unknown as MediaQueryList),
  );
  return {
    setDark(dark: boolean) {
      state.matches = dark;
      for (const cb of state.listeners) {
        cb({ matches: dark } as MediaQueryListEvent);
      }
    },
  };
}

/** jsdom here exposes no global `localStorage`; install an in-memory stub. */
function installLocalStorage(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

beforeEach(() => {
  installLocalStorage();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness({ onReady }: { onReady: (t: ReturnType<typeof useTheme>) => void }) {
  const theme = useTheme();
  onReady(theme);
  return (
    <span data-testid="resolved" data-scheme={theme.resolved}>
      {theme.preference}
    </span>
  );
}

function renderTheme() {
  let captured: ReturnType<typeof useTheme> | null = null;
  render(<Harness onReady={(t) => (captured = t)} />);
  return captured as unknown as ReturnType<typeof useTheme>;
}

/** Reads the live resolved scheme from the rendered DOM (the authoritative,
 *  up-to-date value after a re-render) rather than a captured stale object. */
function resolvedScheme(): "light" | "dark" {
  const node = screen.getByTestId("resolved");
  const scheme = node.getAttribute("data-scheme");
  if (scheme !== "light" && scheme !== "dark") {
    throw new Error(`unexpected resolved scheme: ${scheme}`);
  }
  return scheme;
}

describe("useTheme", () => {
  it("declares light + dark palettes and follows the system scheme in the CSS", () => {
    expect(themesCss).toContain("prefers-color-scheme: dark");
    expect(themesCss).toContain('[data-theme="dark"]');
    expect(themesCss).toContain('[data-theme="light"]');
    expect(themesCss).toContain("--studio-canvas");
    expect(themesCss).toContain("color-scheme");
  });

  it("follows the OS scheme by default and flips when the system changes", () => {
    const mock = installMatchMedia(true);
    const theme = renderTheme();
    expect(theme.resolved).toBe("dark");
    expect(resolvedScheme()).toBe("dark");

    act(() => mock.setDark(false));
    expect(resolvedScheme()).toBe("light");
  });

  it("opposes the system by setting data-theme, and reverts to system on reset", () => {
    installMatchMedia(false);
    const theme = renderTheme();
    expect(theme.resolved).toBe("light");
    expect(resolvedScheme()).toBe("light");

    act(() => theme.setTheme("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(resolvedScheme()).toBe("dark");

    act(() => theme.setTheme("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(resolvedScheme()).toBe("light");

    act(() => theme.setTheme("system"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(resolvedScheme()).toBe("light");
  });

  it("persists the explicit preference and restores it on the next mount", () => {
    installMatchMedia(false);
    const first = renderTheme();
    act(() => first.setTheme("dark"));
    expect(window.localStorage.getItem("studio-theme")).toBe("dark");

    // A fresh mount reads the stored preference ("dark") instead of the OS.
    const second = renderTheme();
    expect(second.preference).toBe("dark");
    expect(second.resolved).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
