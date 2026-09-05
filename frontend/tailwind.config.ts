import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Every color below resolves through a CSS custom property defined
        // in globals.css (:root and [data-theme="..."] blocks), rather than
        // a fixed hex value. Switching themes is then just setting a
        // data-theme attribute on <html> -- no page, component, or class
        // name anywhere in the app needs to change. The rgb(var(...) /
        // <alpha-value>) form is required (not plain var()) so opacity
        // modifiers like bg-brass/15 or text-ink/60 keep working.
        ink: "rgb(var(--ink) / <alpha-value>)",
        ledger: {
          DEFAULT: "rgb(var(--ledger) / <alpha-value>)",
          dark: "rgb(var(--ledger-dark) / <alpha-value>)",
          light: "rgb(var(--ledger-light) / <alpha-value>)",
        },
        paper: {
          DEFAULT: "rgb(var(--paper) / <alpha-value>)",
          card: "rgb(var(--paper-card) / <alpha-value>)",
        },
        brass: {
          DEFAULT: "rgb(var(--brass) / <alpha-value>)",
          dark: "rgb(var(--brass-dark) / <alpha-value>)",
          light: "rgb(var(--brass-light) / <alpha-value>)",
        },
        rule: "rgb(var(--rule) / <alpha-value>)",
        stamp: {
          green: "rgb(var(--stamp-green) / <alpha-value>)",
          red: "rgb(var(--stamp-red) / <alpha-value>)",
          amber: "rgb(var(--stamp-amber) / <alpha-value>)",
          slate: "rgb(var(--stamp-slate) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--border) / <alpha-value>)",
        },
        // Sidebar background is always a dark surface in every theme, so
        // its text needs its own fixed-light token -- NOT the `paper`
        // token, which is the page background and flips dark in Black/Navy.
        // Reusing `paper` here was the exact bug that made sidebar text
        // disappear when Black/Navy were first tried.
        "sidebar-ink": "rgb(var(--sidebar-ink) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "6px",
        shell: "16px",
      },
      boxShadow: {
        // Defined per-theme in globals.css: a soft drop-shadow reads fine
        // on light paper but is nearly invisible on a dark surface, so the
        // Black/Navy values swap to a crisp 1px outline plus a stronger,
        // darker glow instead.
        card: "var(--shadow-card)",
        shell: "var(--shadow-shell)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "100% 0" },
          "100%": { backgroundPosition: "-100% 0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
