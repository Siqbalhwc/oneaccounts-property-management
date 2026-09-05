"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

export type ThemeName = "ledger" | "black" | "navy";

export const THEME_NAMES: ThemeName[] = ["ledger", "black", "navy"];

export const STORAGE_KEY = "oa-theme";

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_NAMES as string[]).includes(value);
}

/**
 * Literal color values mirroring the CSS variables in globals.css, for the
 * handful of places (Recharts, raw SVG stroke/fill) that need an actual
 * color string rather than a Tailwind class. Keep this in sync with the
 * :root / [data-theme="..."] blocks in globals.css if a palette changes.
 */
export const THEME_COLORS: Record<
  ThemeName,
  {
    ink: string;
    ledger: string;
    brass: string;
    stampGreen: string;
    stampRed: string;
    stampAmber: string;
    stampSlate: string;
    border: string;
    paperCard: string;
  }
> = {
  ledger: {
    ink: "#1F2D24",
    ledger: "#2F4F3D",
    brass: "#C89B5C",
    stampGreen: "#2F4F3D",
    stampRed: "#A63D40",
    stampAmber: "#B8862E",
    stampSlate: "#565F5A",
    border: "#DCD7C4",
    paperCard: "#FBFAF5",
  },
  black: {
    ink: "#EDEDE7",
    ledger: "#2E3A31",
    brass: "#E0B978",
    stampGreen: "#8FCDA8",
    stampRed: "#F09999",
    stampAmber: "#E0B978",
    stampSlate: "#A3A8A3",
    border: "#2A2D29",
    paperCard: "#161816",
  },
  navy: {
    ink: "#E7ECF3",
    ledger: "#3D5A82",
    brass: "#D4AF37",
    stampGreen: "#79C5A0",
    stampRed: "#E68F85",
    stampAmber: "#D4AF37",
    stampSlate: "#96A6C2",
    border: "#283755",
    paperCard: "#152033",
  },
};

/**
 * Inline script string meant to be injected via next/script (beforeInteractive)
 * or a raw <script> tag in the root layout's <head>, so the correct theme is
 * set on <html> before first paint -- otherwise the page would flash the
 * default "ledger" theme for a moment on every load for anyone using Black
 * or Navy. Runs before React hydrates, so it reads localStorage only (the
 * account's saved preference from the database arrives a moment later via
 * ThemeProvider and reconciles if it differs, e.g. on a new device).
 */
export const THEME_BLOCKING_SCRIPT = `
(function () {
  try {
    var t = window.localStorage.getItem("${STORAGE_KEY}");
    if (t === "ledger" || t === "black" || t === "navy") {
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch (e) {}
})();
`;

type ThemeContextValue = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "ledger",
  setTheme: () => {},
});

function applyThemeAttribute(theme: ThemeName) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function ThemeProvider({
  initialTheme,
  children,
}: {
  // The account's saved theme_preference, once the profile has loaded from
  // the database. Undefined/null while still loading or for logged-out
  // pages -- the browser's own localStorage value (or the "ledger" default)
  // is used until then.
  initialTheme?: string | null;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    if (isThemeName(initialTheme)) return initialTheme;
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isThemeName(stored)) return stored;
    }
    return "ledger";
  });

  // Once the account's saved preference arrives from the server it wins
  // over whatever the blocking script guessed from localStorage -- this is
  // what makes the theme sync across devices rather than staying stuck to
  // whatever a particular browser last had.
  useEffect(() => {
    if (isThemeName(initialTheme) && initialTheme !== theme) {
      setThemeState(initialTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTheme]);

  useEffect(() => {
    applyThemeAttribute(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private browsing / storage disabled -- theme still applies for
      // this session, it just won't be remembered on next visit.
    }
  }, [theme]);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    // Best-effort save. A failed request just means this choice hasn't
    // synced to other devices yet -- it still applies immediately here.
    api.patch("/profile/me", { theme_preference: t }).catch(() => {});
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
